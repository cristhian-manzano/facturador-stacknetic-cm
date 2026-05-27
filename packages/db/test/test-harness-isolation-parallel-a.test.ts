/**
 * Cross-file isolation test (worker A).
 *
 * Pairs with `test-harness-isolation-parallel-b.test.ts` to prove the harness
 * survives Vitest's default thread-pool parallelism (`maxThreads ≥ 2` per
 * the shared config).  Each file writes the SAME synthetic RUC into ITS OWN
 * schema; if isolation is real, both inserts must succeed.  If both writers
 * accidentally hit `public`, one of the two unique-constraint inserts would
 * raise and the corresponding test fails.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "../src/index.js";
import { createTestSchema, dropTestSchema, type TestSchema } from "../src/test-harness.js";

const SHARED_RUC = "9999333333001";

describe("test-harness — cross-file isolation (worker A)", () => {
  let handle: TestSchema | undefined;

  beforeAll(async () => {
    handle = await createTestSchema();
  });

  afterAll(async () => {
    if (handle !== undefined) await dropTestSchema(handle);
  });

  it("inserts SHARED_RUC and sees count = 1 in its schema", async () => {
    expect(handle).toBeDefined();
    // Non-null assertion: `expect(handle).toBeDefined()` above narrows for
    // the runtime, but TS sees `handle: TestSchema | undefined` here.

    const h = handle!;
    await h.prisma.company.create({
      data: {
        id: newId(),
        ruc: SHARED_RUC,
        razonSocial: "WORKER A TENANT",
        ambiente: "1",
        tipoEmision: "1",
        direccionMatriz: "Quito",
      },
    });
    const count = await h.prisma.company.count({ where: { ruc: SHARED_RUC } });
    expect(count).toBe(1);
  });
});
