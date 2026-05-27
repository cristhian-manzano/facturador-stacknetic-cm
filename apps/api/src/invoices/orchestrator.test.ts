/**
 * Unit tests for orchestrator-level pure helpers. Per
 * production-readiness §12 (mensajes guarantee).
 *
 * The HTTP-level orchestrator flow is exercised in
 * `apps/api/test/invoices.test.ts` against a real Supertest agent + MSW
 * stub; this file covers the small pure helper that lives next to it.
 */
import { describe, expect, it } from "vitest";

import { ensureMensajesNonEmpty } from "./orchestrator.js";

describe("ensureMensajesNonEmpty", () => {
  it("returns the original mensajes when present", () => {
    const out = ensureMensajesNonEmpty("DEVUELTA", [
      { identificador: "35", tipo: "ERROR", mensaje: "Firma inválida" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.identificador).toBe("35");
  });

  it("synthesises a single mensaje on DEVUELTA with empty list", () => {
    const out = ensureMensajesNonEmpty("DEVUELTA", []);
    expect(out).toHaveLength(1);
    expect(out[0]?.identificador).toBe("UNKNOWN");
    expect(out[0]?.tipo).toBe("ERROR");
  });

  it("synthesises on NO_AUTORIZADO with undefined mensajes", () => {
    const out = ensureMensajesNonEmpty("NO_AUTORIZADO", undefined);
    expect(out).toHaveLength(1);
    expect(out[0]?.identificador).toBe("UNKNOWN");
  });

  it("does NOT synthesise on AUTORIZADO (no mensajes is fine)", () => {
    const out = ensureMensajesNonEmpty("AUTORIZADO", undefined);
    expect(out).toEqual([]);
  });
});
