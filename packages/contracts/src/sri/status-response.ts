/**
 * `DocumentStatusResponseSchema` — response of
 * `GET /v1/documents/:claveAcceso/status` (SPEC-0020 §FR-2).
 *
 * Combines the persisted `SriDocument` with its chronological event log.
 */
import { z } from "zod";
import { SriDocumentSchema } from "./document.js";
import { SriEventSchema } from "./event.js";

export const DocumentStatusResponseSchema = z.object({
  document: SriDocumentSchema,
  events: z.array(SriEventSchema),
});

export type DocumentStatusResponse = z.infer<typeof DocumentStatusResponseSchema>;
