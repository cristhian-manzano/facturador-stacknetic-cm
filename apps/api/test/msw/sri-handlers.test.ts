/**
 * Verifies the SRI Core MSW handlers (TASKS-0007 §4.3).
 *
 *   - The MSW server registered by the workspace setup file intercepts
 *     `fetch(SRI_CORE_BASE_URL + ...)` calls so api integration tests do
 *     not touch the real sri-core.
 *   - The handlers `parse` their responses against
 *     `EmitDocumentResponseSchema` / `DocumentStatusResponseSchema` — drift
 *     in either side would crash the handler and surface as a test failure.
 */
import { describe, expect, it } from "vitest";
import {
  EmitDocumentResponseSchema,
  DocumentStatusResponseSchema,
} from "@facturador/contracts/sri";
import { mswServer } from "./server.js";
import { sriCoreEmitHandlers, SRI_CORE_BASE_URL } from "./sri-handlers.js";

describe("MSW sri-core handlers", () => {
  it("POST /v1/documents/emit returns a parsed EmitDocumentResponse", async () => {
    mswServer.use(...sriCoreEmitHandlers);

    const res = await fetch(`${SRI_CORE_BASE_URL}/v1/documents/emit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ping: 1 }),
    });
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    const parsed = EmitDocumentResponseSchema.parse(json);
    expect(parsed.estado).toBe("AUTORIZADO");
    expect(parsed.claveAcceso).toHaveLength(49);
  });

  it("GET /v1/documents/:claveAcceso/status returns a DocumentStatusResponse", async () => {
    mswServer.use(...sriCoreEmitHandlers);

    // Same shape as STUB_CLAVE_ACCESO in sri-handlers.ts.
    const clave =
      "18012026" + "01" + "9999000001001" + "1" + "001001" + "000000001" + "12345678" + "1" + "0";
    const res = await fetch(`${SRI_CORE_BASE_URL}/v1/documents/${clave}/status`);
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    const parsed = DocumentStatusResponseSchema.parse(json);
    expect(parsed.document.claveAcceso).toBe(clave);
    expect(parsed.events.length).toBeGreaterThanOrEqual(2);
    const etapas = parsed.events.map((e) => e.etapa);
    expect(etapas).toContain("BUILD");
    expect(etapas).toContain("AUTHORIZE");
  });
});
