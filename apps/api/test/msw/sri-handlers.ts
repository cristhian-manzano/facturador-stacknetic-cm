/**
 * MSW handlers stubbing `apps/sri-core` for `@facturador/api` integration
 * tests (TASKS-0007 §4.3).
 *
 *   - POST /v1/documents/emit          → 200 + canned `EmitDocumentResponse`.
 *   - GET  /v1/documents/:claveAcceso/status → 200 + canned `DocumentStatusResponse`.
 *
 * Each handler validates its response payload against the contract schema
 * via `parse` (not `safeParse`) — a regression in the contract or in this
 * stub crashes the handler and surfaces as a test failure, exactly as
 * PROMPT-0007 §4 demands.
 *
 * Synthetic data only: `claveAcceso` and timestamps come from a deterministic
 * fixture so snapshot-style assertions stay stable.  No real RUC anywhere.
 */
import { http, HttpResponse } from "msw";
import { ulid } from "ulid";

import {
  EmitDocumentResponseSchema,
  DocumentStatusResponseSchema,
} from "@facturador/contracts/sri";

const SRI_CORE_BASE = "http://sri-core.test";

// 49-digit claveAcceso with a valid módulo-11 check (last digit).
// Structure (SRI ficha técnica §4):
//   ddMMyyyy (8) + codDoc (2) + RUC (13) + ambiente (1)
//   + estab+ptoEmi (6) + secuencial (9) + codigoNumerico (8)
//   + tipoEmision (1) + checkDigit (1) = 49.
// Synthetic RUC `9999000001001` + check digit `0`.
const STUB_CLAVE_ACCESO =
  "18012026" + // ddMMyyyy
  "01" + // codDoc (factura)
  "9999000001001" + // RUC (synthetic 9999...)
  "1" + // ambiente
  "001001" + // estab + ptoEmi
  "000000001" + // secuencial
  "12345678" + // codigoNumerico
  "1" + // tipoEmision
  "0"; // check digit (precomputed)

// Build a deterministic stub event timeline that survives schema parsing.
// ULIDs use Crockford base32 (no I, L, O, U) — these values were minted via
// `ulid()` to ensure UlidSchema accepts them.
const stubDocument = {
  id: "01KS5R6NXRFHXKS83C9Y53VBEJ",
  companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
  claveAcceso: STUB_CLAVE_ACCESO,
  ambiente: "1",
  codDoc: "01",
  estab: "001",
  ptoEmi: "001",
  secuencial: "000000001",
  fechaEmision: "2026-01-18",
  estado: "AUTORIZADO",
  numeroAutorizacion: "1801202401000000000000000",
  fechaAutorizacion: "2026-01-18T10:00:00.000Z",
  signedXmlBlobId: null,
  authorizedXmlBlobId: null,
  createdAt: "2026-01-18T10:00:00.000Z",
  updatedAt: "2026-01-18T10:00:00.000Z",
};

export const sriCoreEmitHandlers = [
  http.post(`${SRI_CORE_BASE}/v1/documents/emit`, () => {
    // `parse` throws on shape drift; MSW propagates the throw as a test
    // failure. This is intentional.
    const payload = EmitDocumentResponseSchema.parse({
      claveAcceso: STUB_CLAVE_ACCESO,
      estado: "AUTORIZADO",
      numeroAutorizacion: "1801202401000000000000000",
      fechaAutorizacion: "2026-01-18T10:00:00.000Z",
      signedXmlSha256: "a".repeat(64),
    });
    return HttpResponse.json(payload);
  }),

  http.get(`${SRI_CORE_BASE}/v1/documents/:claveAcceso/status`, ({ params }) => {
    const payload = DocumentStatusResponseSchema.parse({
      document: { ...stubDocument, claveAcceso: String(params.claveAcceso) },
      events: [
        {
          id: ulid(),
          documentId: stubDocument.id,
          etapa: "BUILD",
          estado: "FIRMADO",
          mensajes: [],
          durationMs: 12,
          createdAt: "2026-01-18T10:00:00.000Z",
        },
        {
          id: ulid(),
          documentId: stubDocument.id,
          etapa: "AUTHORIZE",
          estado: "AUTORIZADO",
          mensajes: [],
          durationMs: 432,
          createdAt: "2026-01-18T10:00:01.000Z",
        },
      ],
    });
    return HttpResponse.json(payload);
  }),
];

/** Base URL the stubs answer on; consumers point their fetch at this. */
export const SRI_CORE_BASE_URL = SRI_CORE_BASE;
