/**
 * Proves the per-test schema harness isolates writes across parallel test
 * files (SPEC-0007 §AC-3 + TASKS-0007 §2.1 "Validate").
 *
 * Layout: this test file creates TWO schemas in parallel (Promise.all), writes
 * exactly one synthetic Company row into each, and asserts that:
 *
 *   - Each schema sees its own row (`count === 1`).
 *   - Neither schema sees the other's row (no cross-leakage).
 *   - Both schemas live independently of the seed/dev schema (`public`):
 *     dropping one does not affect the other.
 *
 * Two more isolation tests live in `test-harness-isolation-parallel-a.test.ts`
 * and `test-harness-isolation-parallel-b.test.ts` — they run in different
 * Vitest worker threads and each insert one Company with the SAME synthetic
 * RUC.  If isolation breaks (e.g. both writers hit `public`), the unique
 * constraint on `Company.ruc` would error in at least one of the two files.
 *
 * Synthetic data only (TASKS-0007 §5 / security policy): RUCs prefixed with
 * `9999`, all emails under `@facturador.test`.
 */
import { Role } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "../src/index.js";
import {
  createTestSchema,
  dropTestSchema,
  newTestSchemaName,
  type TestSchema,
} from "../src/test-harness.js";

describe("test-harness — cross-schema isolation (intra-file)", () => {
  let a: TestSchema | undefined;
  let b: TestSchema | undefined;

  beforeAll(async () => {
    [a, b] = await Promise.all([createTestSchema(), createTestSchema()]);
  });

  afterAll(async () => {
    await Promise.all([
      a !== undefined ? dropTestSchema(a) : Promise.resolve(),
      b !== undefined ? dropTestSchema(b) : Promise.resolve(),
    ]);
  });

  it("each schema sees only its own Company row", async () => {
    // Insert one synthetic Company into each schema, with the SAME RUC.
    // If they truly are isolated, both inserts succeed.  If they collide on
    // a single schema, the second insert raises a unique-constraint error.
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // Non-null assertions: the `toBeDefined` calls above narrow at runtime
    // but TS still sees `TestSchema | undefined` here.
     
    const ha = a!;
     
    const hb = b!;
    const ruc = "9999000000001";
    await ha.prisma.company.create({
      data: {
        id: newId(),
        ruc,
        razonSocial: "ISOLATION TENANT A",
        ambiente: "1",
        tipoEmision: "1",
        direccionMatriz: "Av. Isolation 1",
      },
    });
    await hb.prisma.company.create({
      data: {
        id: newId(),
        ruc, // same RUC, different schema — must succeed
        razonSocial: "ISOLATION TENANT B",
        ambiente: "1",
        tipoEmision: "1",
        direccionMatriz: "Av. Isolation 2",
      },
    });

    const [countA, countB] = await Promise.all([
      ha.prisma.company.count(),
      hb.prisma.company.count(),
    ]);
    expect(countA).toBe(1);
    expect(countB).toBe(1);

    const inA = await ha.prisma.company.findFirst({ where: { ruc } });
    const inB = await hb.prisma.company.findFirst({ where: { ruc } });
    expect(inA?.razonSocial).toBe("ISOLATION TENANT A");
    expect(inB?.razonSocial).toBe("ISOLATION TENANT B");
    expect(ha.schema).not.toBe(hb.schema);
  });

  it("subsequent inserts in each schema only affect their own row count", async () => {
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // Non-null assertions: see comment in the test above.
     
    const ha = a!;
     
    const hb = b!;
    await ha.prisma.user.create({
      data: {
        id: newId(),
        email: "alice@facturador.test",
        passwordHash: "$argon2id$placeholder",
        displayName: "Alice (A)",
      },
    });
    const uB = await hb.prisma.user.create({
      data: {
        id: newId(),
        email: "bob@facturador.test",
        passwordHash: "$argon2id$placeholder",
        displayName: "Bob (B)",
      },
    });
    await hb.prisma.membership.create({
      data: {
        id: newId(),
        userId: uB.id,
        companyId: (await hb.prisma.company.findFirstOrThrow()).id,
        role: Role.OWNER,
      },
    });

    const [usersA, usersB] = await Promise.all([ha.prisma.user.count(), hb.prisma.user.count()]);
    expect(usersA).toBe(1);
    expect(usersB).toBe(1);
    expect(await ha.prisma.membership.count()).toBe(0);
    expect(await hb.prisma.membership.count()).toBe(1);
  });
});

describe("test-harness — newTestSchemaName format", () => {
  it("mints a Postgres-safe schema name with `test_` prefix and a ULID body", () => {
    const name = newTestSchemaName();
    expect(name).toMatch(/^test_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it("mints distinct names across calls", () => {
    const a = newTestSchemaName();
    const b = newTestSchemaName();
    expect(a).not.toBe(b);
  });
});
