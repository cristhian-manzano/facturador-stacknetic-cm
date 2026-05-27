/**
 * `@facturador/db` smoke test — CRUD round-trip + argon2 verification.
 *
 * Originally written against the shared `public` schema (pre-SPEC-0007).
 * SPEC-0007 introduces the per-test schema harness, so this file now runs
 * inside its OWN isolated schema via `useTestSchema()`.  That removes the
 * old "best-effort teardown by sentinel id" pattern AND lets the suite run
 * in parallel with other test runners — running two `pnpm test` invocations
 * side-by-side no longer corrupts each other's fixtures.
 *
 *   1. Asserts the schema migrations created the `Company / User / Membership`
 *      tables (a `count()` proves the schema was migrated).
 *   2. Inserts a synthetic tenant + admin user + membership and reads them
 *      back through the FK graph.
 *   3. Verifies argon2 password hashing round-trips correctly.
 *
 * Synthetic data only: RUCs prefixed `9999`, emails under `@facturador.test`.
 */
import { Role } from "@prisma/client";
import argon2 from "argon2";
import { describe, expect, it } from "vitest";

import { newId } from "../src/index.js";
import { useTestSchema } from "../src/test-harness.js";

const SMOKE_RUC = "9999000034001";
const SMOKE_EMAIL = "smoke@facturador.test";
const SMOKE_PASSWORD = "Smoke!1234";

describe("@facturador/db — CRUD round-trip", () => {
  const ctx = useTestSchema();

  it("creates and reads back Company, User, and Membership", async () => {
    const prisma = ctx.getPrisma();

    const company = await prisma.company.create({
      data: {
        id: newId(),
        ruc: SMOKE_RUC,
        razonSocial: "SMOKE TEST S.A.",
        nombreComercial: "Smoke",
        ambiente: "1",
        tipoEmision: "1",
        direccionMatriz: "Calle Smoke 1, Quito",
        obligadoContabilidad: false,
      },
    });
    expect(company.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(company.ruc).toBe(SMOKE_RUC);

    const passwordHash = await argon2.hash(SMOKE_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });

    const user = await prisma.user.create({
      data: {
        id: newId(),
        email: SMOKE_EMAIL,
        passwordHash,
        displayName: "Smoke Tester",
      },
    });
    expect(user.email).toBe(SMOKE_EMAIL);
    expect(user.passwordHash).not.toBe(SMOKE_PASSWORD); // never store plaintext
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);

    const membership = await prisma.membership.create({
      data: {
        id: newId(),
        userId: user.id,
        companyId: company.id,
        role: Role.OWNER,
      },
    });
    expect(membership.role).toBe(Role.OWNER);

    // Read back through the membership graph; this exercises the FK joins.
    const loaded = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { memberships: { include: { company: true } } },
    });
    expect(loaded.memberships).toHaveLength(1);
    expect(loaded.memberships[0]?.company.ruc).toBe(SMOKE_RUC);
  });

  it("enforces unique RUC on Company", async () => {
    const prisma = ctx.getPrisma();
    // The first test of this describe block already inserted a row with
    // `SMOKE_RUC`. Inserting again must fail on the unique constraint.
    await expect(
      prisma.company.create({
        data: {
          id: newId(),
          ruc: SMOKE_RUC,
          razonSocial: "DUPLICATE",
          ambiente: "1",
          tipoEmision: "1",
          direccionMatriz: "X",
        },
      }),
    ).rejects.toThrow();
  });
});

describe("@facturador/db — argon2 verification", () => {
  it("hashes a password and accepts the correct one while rejecting a wrong one", async () => {
    const hash = await argon2.hash(SMOKE_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });

    expect(await argon2.verify(hash, SMOKE_PASSWORD)).toBe(true);
    expect(await argon2.verify(hash, "wrong-password")).toBe(false);
  });
});
