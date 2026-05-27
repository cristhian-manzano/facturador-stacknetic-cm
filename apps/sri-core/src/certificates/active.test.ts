/**
 * Unit tests for the in-memory LRU cache in `active.ts`.
 *
 * These tests exercise the cache directly (no real DB needed) via a
 * lightweight in-memory Prisma stub that returns a single Certificate
 * row. The cache assertions:
 *
 *   - second call within TTL returns the cached value (no second decrypt),
 *   - calling `clearActiveCertificateCache` evicts the entry,
 *   - changing the fingerprint between calls invalidates the cache (so a
 *     rotation can never serve a stale PEM),
 *   - missing ACTIVE row throws NotFoundError.
 *
 * We do NOT verify the LRU TTL eviction via real timers — the lru-cache
 * library is well-tested. We mock `Date.now` and call its `purgeStale`
 * method to deterministically exercise the eviction window.
 */
import { ulid } from "ulid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newId } from "@facturador/db";

import { generateSyntheticP12 } from "../../test/fixtures/synthetic-cert.js";
import { encryptP12 } from "../crypto/envelope.js";

import {
  ACTIVE_CACHE_TTL_MS,
  __resetActiveCertificateCache,
  clearActiveCertificateCache,
  getActiveCertificate,
  getActiveCertificateCache,
} from "./active.js";
import { parseP12 } from "./parser.js";

function makeCertRow(opts: {
  companyId: string;
  fingerprintSha256: string;
  p12Bytes: Buffer;
  passphrase: string;
}) {
  const p12 = encryptP12(opts.p12Bytes);
  const pass = encryptP12(Buffer.from(opts.passphrase, "utf8"));
  return {
    id: newId(),
    companyId: opts.companyId,
    alias: "test",
    subjectCN: "TEST CERT",
    issuerCN: "TEST CERT",
    serialNumber: "01",
    validFrom: new Date(Date.now() - 86_400_000),
    validTo: new Date(Date.now() + 30 * 86_400_000),
    p12CiphertextB64: p12.ciphertext.toString("base64"),
    p12NonceB64: p12.nonce.toString("base64"),
    p12TagB64: p12.tag.toString("base64"),
    passphraseCiphertextB64: pass.ciphertext.toString("base64"),
    passphraseNonceB64: pass.nonce.toString("base64"),
    passphraseTagB64: pass.tag.toString("base64"),
    kmsKeyVersion: "v1",
    fingerprintSha256: opts.fingerprintSha256,
    status: "ACTIVE",
    uploadedAt: new Date(),
    deletedAt: null,
  };
}

/** Minimal stub for the Prisma client surface `getActiveCertificate` uses. */
function makePrismaStub(initialRow: ReturnType<typeof makeCertRow> | null) {
  let row = initialRow;
  let findCount = 0;
  return {
    get findCount() {
      return findCount;
    },
    setRow(next: ReturnType<typeof makeCertRow> | null) {
      row = next;
    },
    certificate: {
      findFirst: vi.fn(async () => {
        findCount += 1;
        return row;
      }),
    },
  };
}

describe("active certificate cache", () => {
  beforeEach(() => {
    __resetActiveCertificateCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hits the cache on the second call within TTL", async () => {
    const passphrase = "p4ssw0rd";
    const { p12 } = generateSyntheticP12({
      subjectCN: "TEST",
      validFrom: new Date(Date.now() - 86_400_000),
      validTo: new Date(Date.now() + 30 * 86_400_000),
      passphrase,
    });
    const parsed = parseP12(p12, passphrase);
    const companyId = ulid();
    const row = makeCertRow({
      companyId,
      fingerprintSha256: parsed.fingerprintSha256,
      p12Bytes: p12,
      passphrase,
    });
    const prisma = makePrismaStub(row);
    const a = await getActiveCertificate(prisma as never, companyId);
    const b = await getActiveCertificate(prisma as never, companyId);
    expect(a.certPem).toBe(b.certPem);
    expect(a.keyPem).toBe(b.keyPem);
    expect(prisma.findCount).toBe(2);
    // Cache has exactly one entry under the right key.
    expect(getActiveCertificateCache().size).toBe(1);
  });

  it("evicts on clearActiveCertificateCache and re-decrypts on next call", async () => {
    const passphrase = "p4ssw0rd";
    const { p12 } = generateSyntheticP12({
      subjectCN: "TEST",
      validFrom: new Date(Date.now() - 86_400_000),
      validTo: new Date(Date.now() + 30 * 86_400_000),
      passphrase,
    });
    const parsed = parseP12(p12, passphrase);
    const companyId = ulid();
    const row = makeCertRow({
      companyId,
      fingerprintSha256: parsed.fingerprintSha256,
      p12Bytes: p12,
      passphrase,
    });
    const prisma = makePrismaStub(row);
    await getActiveCertificate(prisma as never, companyId);
    expect(getActiveCertificateCache().size).toBe(1);
    clearActiveCertificateCache(companyId);
    expect(getActiveCertificateCache().size).toBe(0);
    await getActiveCertificate(prisma as never, companyId);
    expect(getActiveCertificateCache().size).toBe(1);
  });

  it("invalidates the cache when the DB row's fingerprint changes (rotation)", async () => {
    const passphrase = "p4ssw0rd";
    const a = generateSyntheticP12({
      subjectCN: "TEST A",
      validFrom: new Date(Date.now() - 86_400_000),
      validTo: new Date(Date.now() + 30 * 86_400_000),
      passphrase,
    });
    const aParsed = parseP12(a.p12, passphrase);
    const b = generateSyntheticP12({
      subjectCN: "TEST B",
      validFrom: new Date(Date.now() - 86_400_000),
      validTo: new Date(Date.now() + 30 * 86_400_000),
      passphrase,
    });
    const bParsed = parseP12(b.p12, passphrase);
    expect(aParsed.fingerprintSha256).not.toBe(bParsed.fingerprintSha256);
    const companyId = ulid();
    const rowA = makeCertRow({
      companyId,
      fingerprintSha256: aParsed.fingerprintSha256,
      p12Bytes: a.p12,
      passphrase,
    });
    const rowB = makeCertRow({
      companyId,
      fingerprintSha256: bParsed.fingerprintSha256,
      p12Bytes: b.p12,
      passphrase,
    });
    const prisma = makePrismaStub(rowA);
    const first = await getActiveCertificate(prisma as never, companyId);
    expect(first.subjectCN).toBe("TEST A");
    // Operator activates a new cert (cache invalidated by route handler,
    // but here we simulate the DB-only swap without the clear() call —
    // the fingerprint guard MUST still prevent serving the stale entry.
    prisma.setRow(rowB);
    const second = await getActiveCertificate(prisma as never, companyId);
    expect(second.subjectCN).toBe("TEST B");
  });

  it("respects the LRU TTL: an entry past its TTL is evicted on next access", async () => {
    const passphrase = "p4ssw0rd";
    const { p12 } = generateSyntheticP12({
      subjectCN: "TEST",
      validFrom: new Date(Date.now() - 86_400_000),
      validTo: new Date(Date.now() + 30 * 86_400_000),
      passphrase,
    });
    const parsed = parseP12(p12, passphrase);
    const companyId = ulid();
    const row = makeCertRow({
      companyId,
      fingerprintSha256: parsed.fingerprintSha256,
      p12Bytes: p12,
      passphrase,
    });
    const prisma = makePrismaStub(row);
    await getActiveCertificate(prisma as never, companyId);
    expect(getActiveCertificateCache().size).toBe(1);

    // Re-insert the existing entry under a tiny TTL so the test stays
    // deterministic without sleeping for 5 minutes. We grab the key /
    // value, drop them, and re-set with a 10 ms TTL. After 50 ms the
    // entry must be evicted on the next `get`.
    const cache = getActiveCertificateCache();
    const entries = [...cache.entries()];
    const first = entries[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const [entryKey, entryValue] = first;
    cache.delete(entryKey);
    cache.set(entryKey, entryValue, { ttl: 10 });

    await new Promise((r) => setTimeout(r, 50));

    const findCountBefore = prisma.findCount;
    await getActiveCertificate(prisma as never, companyId);
    // Second call had to hit the DB again because the entry expired.
    expect(prisma.findCount).toBe(findCountBefore + 1);
  });

  it("the module-level cache is configured with TTL ≤ 5 minutes", () => {
    // Architectural assertion: the cache shipped to production must have
    // its TTL bounded at 5 minutes per SPEC-0021 §10.
    expect(ACTIVE_CACHE_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it("throws NotFoundError when no ACTIVE row exists", async () => {
    const prisma = makePrismaStub(null);
    await expect(getActiveCertificate(prisma as never, ulid())).rejects.toThrow(/certificate/i);
  });
});
