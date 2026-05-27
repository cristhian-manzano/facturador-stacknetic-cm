/**
 * Cross-file isolation test (worker B).
 *
 * Mirror of `test-harness-isolation-parallel-a.test.ts` — see that file for
 * the rationale.  Uses the SAME synthetic RUC so a regression where two
 * workers share `public` would surface as a unique-constraint failure.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "../src/index.js";
import { createTestSchema, dropTestSchema, type TestSchema } from "../src/test-harness.js";

const SHARED_RUC = "9999333333001";

describe("test-harness — cross-file isolation (worker B)", () => {
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
        razonSocial: "WORKER B TENANT",
        ambiente: "1",
        tipoEmision: "1",
        direccionMatriz: "Guayaquil",
      },
    });
    const count = await h.prisma.company.count({ where: { ruc: SHARED_RUC } });
    expect(count).toBe(1);
  });
});
