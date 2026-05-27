/**
 * `SriEventSchema` — discriminated by `etapa` per TASKS-0005 §7.2.
 *
 * Etapas:
 *   - `BUILD`     XML constructed.
 *   - `SIGN`      XAdES-BES signature applied.
 *   - `SEND`      Wire call to SRI recepción.
 *   - `RECEIVE`   SRI recepción acknowledged.
 *   - `AUTHORIZE` SRI autorización call.
 *   - `POLL`      Background poll while EN_PROCESO.
 *   - `ERROR`     Anything we want to surface as a red marker in the
 *                  detail-page timeline.
 *
 * The shape is mostly the same across etapas — a discriminated union is
 * still the right call so consumers narrow on `etapa` and so future spec
 * iterations can add etapa-specific fields without breaking the wire
 * contract.
 */
import { z } from "zod";

import { UlidSchema } from "../primitives/ulid.js";

import { SriEstadoSchema } from "./document.js";
import { SriMensajeSchema } from "./mensaje.js";

const BaseEvent = z.object({
  id: UlidSchema,
  documentId: UlidSchema,
  estado: SriEstadoSchema,
  mensajes: z.array(SriMensajeSchema),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export const SriEventSchema = z.discriminatedUnion("etapa", [
  BaseEvent.extend({ etapa: z.literal("BUILD") }),
  BaseEvent.extend({ etapa: z.literal("SIGN") }),
  BaseEvent.extend({ etapa: z.literal("SEND") }),
  BaseEvent.extend({ etapa: z.literal("RECEIVE") }),
  BaseEvent.extend({ etapa: z.literal("AUTHORIZE") }),
  BaseEvent.extend({ etapa: z.literal("POLL") }),
  BaseEvent.extend({ etapa: z.literal("ERROR") }),
]);

export type SriEvent = z.infer<typeof SriEventSchema>;
export const SriEtapaSchema = z.enum([
  "BUILD",
  "SIGN",
  "SEND",
  "RECEIVE",
  "AUTHORIZE",
  "POLL",
  "ERROR",
]);
export type SriEtapa = z.infer<typeof SriEtapaSchema>;
