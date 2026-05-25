/**
 * `getActiveCertificate` + LRU cache for in-memory PEMs.
 *
 * Source of truth:
 *   - SPEC-0021 §6.5 (loadActiveCertForSigning) + §10 (no plaintext PEMs
 *     on disk, no plaintext PEMs in any API response).
 *   - PLAN-0021 §4 (LRU + TTL ≤ 5 min, invalidated on activate).
 *   - TASKS-0021 §6.1.
 *
 * Cache shape:
 *   - Key: `${companyId}:${fingerprintSha256}` (we include the fingerprint
 *     so a rotation invalidates any stale entry naturally; the explicit
 *     `clearActiveCertificateCache(companyId)` covers the same window
 *     because it wipes every entry under that prefix).
 *   - Value: `{ certPem, keyPem, subjectCN, expiresAt }`.
 *   - Capacity: 64 entries (per PLAN-0021 §4).
 *   - TTL: 5 minutes — past which an entry is evicted and the next call
 *     re-decrypts + re-parses.
 *
 * Why fingerprint in the key:
 *   - It prevents serving a stale decrypted PEM after a rotation if the
 *     `clearActiveCertificateCache` call accidentally drops (e.g. a future
 *     transactional savepoint that rolls back). The fingerprint comes from
 *     the DB row, so a stale entry never matches a freshly activated cert.
 *
 * No persistence: the LRU lives only in-process. No mechanism here writes
 * `keyPem` or `certPem` to disk, to a log line, or to any response body.
 */
import { LRUCache } from "lru-cache";
import type { Logger } from "@facturador/logger";
import type { Certificate, PrismaClient } from "@facturador/db";
import { NotFoundError } from "@facturador/utils/errors";
import { decryptP12 } from "../crypto/envelope.js";
import { parseP12 } from "./parser.js";

export interface ActiveCertificate {
  readonly certPem: string;
  readonly keyPem: string;
  readonly subjectCN: string;
  readonly expiresAt: Date;
  readonly fingerprintSha256: string;
}

export const ACTIVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — SPEC-0021 §10
export const ACTIVE_CACHE_MAX_ENTRIES = 64; // PLAN-0021 §4

// Module-level cache. A new process gets a fresh map; for tests we expose
// `__resetActiveCertificateCache` to reset between describe blocks.
function buildCache(): LRUCache<string, ActiveCertificate> {
  return new LRUCache<string, ActiveCertificate>({
    max: ACTIVE_CACHE_MAX_ENTRIES,
    ttl: ACTIVE_CACHE_TTL_MS,
    // `ttlResolution: 0` makes the LRU re-evaluate staleness on every
    // `get()` instead of caching a "stale clock" — important so unit
    // tests that time-warp `Date.now` see the entry expire deterministically.
    ttlResolution: 0,
    // The `lru-cache` v11 ttl semantics: when an entry's age exceeds `ttl`
    // it becomes stale. With `allowStale: false` (default) `get()` returns
    // undefined and the entry is purged.
  });
}
let cache = buildCache();

function keyOf(companyId: string, fingerprintSha256: string): string {
  return `${companyId}:${fingerprintSha256}`;
}

function prefixOf(companyId: string): string {
  return `${companyId}:`;
}

/**
 * Test/observability accessor — returns the LRU instance so the suite can
 * `cache.has(...)` without going through the full `getActiveCertificate`
 * path. Not exported from the package index.
 */
export function getActiveCertificateCache(): LRUCache<string, ActiveCertificate> {
  return cache;
}

/**
 * Reset the cache. Tests only; in production the cache lives for the
 * process lifetime.
 */
export function __resetActiveCertificateCache(): void {
  cache = buildCache();
}

/**
 * Clear every cached entry for `companyId`. Called by the activate route
 * inside the same transaction so the next `getActiveCertificate` call
 * decrypts + re-parses against the new row.
 *
 * No-op when the company has nothing cached.
 */
export function clearActiveCertificateCache(companyId: string): void {
  const prefix = prefixOf(companyId);
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

export interface GetActiveCertificateOptions {
  readonly logger?: Pick<Logger, "info" | "warn">;
}

/**
 * Resolve the active cert for a tenant. Returns the in-memory PEMs ready
 * for signing. Throws `NotFoundError("certificate")` if there is no
 * ACTIVE row.
 *
 * Caller note: the result MUST NOT be returned over the wire, written to
 * disk, or logged. It is for signing (in-process) only.
 */
export async function getActiveCertificate(
  prisma: PrismaClient,
  companyId: string,
  options: GetActiveCertificateOptions = {},
): Promise<ActiveCertificate> {
  // Pull the row first — even if a prefix cache entry exists, we still
  // need to verify the DB still has the same fingerprint (a rotation
  // between cache hits would otherwise serve a stale cert).
  const row = await prisma.certificate.findFirst({
    where: {
      companyId,
      status: "ACTIVE",
      deletedAt: null,
    },
  });
  if (row === null) {
    throw new NotFoundError("certificate");
  }

  const key = keyOf(companyId, row.fingerprintSha256);
  const cached = cache.get(key);
  if (cached !== undefined) {
    options.logger?.info(
      {
        event: "certificate.cache_hit",
        companyId,
        fingerprintSha256: row.fingerprintSha256,
      },
      "certificate cache hit",
    );
    return cached;
  }

  const parsed = parseAndDecrypt(row);
  const value: ActiveCertificate = {
    certPem: parsed.certPem,
    keyPem: parsed.keyPem,
    subjectCN: parsed.subjectCN,
    expiresAt: row.validTo,
    fingerprintSha256: row.fingerprintSha256,
  };
  cache.set(key, value);
  options.logger?.info(
    {
      event: "certificate.cache_miss_loaded",
      companyId,
      fingerprintSha256: row.fingerprintSha256,
    },
    "certificate loaded into cache",
  );
  return value;
}

/**
 * Decrypt the envelope columns + re-parse with node-forge.
 *
 * Split from `getActiveCertificate` so tests can verify the parse pipe
 * without an extra DB round-trip.
 */
export function parseAndDecrypt(row: Certificate): {
  readonly certPem: string;
  readonly keyPem: string;
  readonly subjectCN: string;
} {
  const ciphertext = Buffer.from(row.p12CiphertextB64, "base64");
  const nonce = Buffer.from(row.p12NonceB64, "base64");
  const tag = Buffer.from(row.p12TagB64, "base64");
  const p12 = decryptP12({ ciphertext, nonce, tag });
  let passphrase = "";
  if (
    row.passphraseCiphertextB64 !== null &&
    row.passphraseNonceB64 !== null &&
    row.passphraseTagB64 !== null
  ) {
    const passCt = Buffer.from(row.passphraseCiphertextB64, "base64");
    const passNonce = Buffer.from(row.passphraseNonceB64, "base64");
    const passTag = Buffer.from(row.passphraseTagB64, "base64");
    passphrase = decryptP12({
      ciphertext: passCt,
      nonce: passNonce,
      tag: passTag,
    }).toString("utf8");
  }
  // We tolerate already-expired certs at re-parse time: an ACTIVE row
  // that has just crossed validTo is still useful for surfacing in
  // diagnostics, and the cron flips the status to EXPIRED on the next
  // pass.
  const parsed = parseP12(p12, passphrase, { allowExpired: true });
  return {
    certPem: parsed.certPem,
    keyPem: parsed.keyPem,
    subjectCN: parsed.subjectCN,
  };
}
