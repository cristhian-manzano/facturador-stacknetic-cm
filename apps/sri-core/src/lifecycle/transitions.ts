/**
 * `canTransition(from, to)` — pure state-machine predicate.
 *
 * Source of truth:
 *   - SPEC-0026 §6.2 (allowed-transitions matrix; SPEC text reproduced
 *     below).
 *   - PLAN-0026 §3 (matrix reproduced verbatim).
 *   - TASKS-0026 §2.1 ("Reaffirm canTransition(from, to) matches the
 *     table in PLAN §3; add any missing transitions per SPEC-0026").
 *   - PROMPT-0020 §6 ("All DB writes through `recordEvent`; no direct
 *     `estado` mutation elsewhere").
 *
 * The function is fully data-driven from the {@link ALLOWED} table so
 * every change to the matrix lives in one place. Terminal states
 * (`AUTORIZADO`, `NO_AUTORIZADO`, `DEVUELTA`, `ERROR_BUILD`) have empty
 * allowed sets — `recordEvent` rejects any further transitions
 * (including the idempotent self-loop, unless explicitly opted in via
 * `allowSelfLoop: true`).
 *
 * Authoritative SPEC-0026 §6.2 table:
 *
 *   | from \ to      | PENDIENTE | FIRMADO | ENVIADO | RECIBIDA | EN_PROCESO | AUTORIZADO | NO_AUTORIZADO | DEVUELTA | ERROR_RED | ERROR_BUILD         |
 *   | -------------- | --------- | ------- | ------- | -------- | ---------- | ---------- | ------------- | -------- | --------- | ------------------- |
 *   | (initial)      | ✅        |         |         |          |            |            |               |          |           | ✅ (if BUILD fails) |
 *   | PENDIENTE      |           | ✅      |         |          |            |            |               |          |           | ✅                  |
 *   | FIRMADO        |           |         | ✅      |          |            |            |               |          | ✅        |                     |
 *   | ENVIADO        |           |         |         | ✅       |            |            |               | ✅       | ✅        |                     |
 *   | RECIBIDA       |           |         |         |          | ✅         | ✅         | ✅            |          | ✅        |                     |
 *   | EN_PROCESO     |           |         |         |          | (self ✅)  | ✅         | ✅            |          | ✅        |                     |
 *   | ERROR_RED      |           |         | ✅      | ✅       | ✅         | ✅         | ✅            | ✅       | (self ✅) |                     |
 *   | AUTORIZADO     |           |         |         |          |            |            |               |          |           |                     |
 *   | NO_AUTORIZADO  |           |         |         |          |            |            |               |          |           |                     |
 *   | DEVUELTA       |           |         |         |          |            |            |               |          |           |                     |
 *   | ERROR_BUILD    |           |         |         |          |            |            |               |          |           |                     |
 *
 * EN_PROCESO and ERROR_RED both keep a self-loop because the polling
 * job re-confirms those states without progress. `recordEvent` requires
 * `allowSelfLoop: true` to write the no-op so the timeline doesn't fill
 * with duplicate rows by accident.
 */
import { SriEstado } from "@facturador/db";

export type Estado = SriEstado;

/**
 * Allowed forward transitions, frozen so a defect that tries to mutate
 * the table at runtime throws.
 */
export const ALLOWED: Record<Estado, readonly Estado[]> = Object.freeze({
  PENDIENTE: ["FIRMADO", "ERROR_BUILD"],
  ERROR_BUILD: [],
  FIRMADO: ["ENVIADO", "ERROR_RED"],
  ENVIADO: ["RECIBIDA", "DEVUELTA", "ERROR_RED"],
  RECIBIDA: ["AUTORIZADO", "NO_AUTORIZADO", "EN_PROCESO", "ERROR_RED"],
  EN_PROCESO: ["AUTORIZADO", "NO_AUTORIZADO", "EN_PROCESO", "ERROR_RED"],
  ERROR_RED: [
    "RECIBIDA",
    "AUTORIZADO",
    "NO_AUTORIZADO",
    "EN_PROCESO",
    "DEVUELTA",
    "ERROR_RED",
    "ENVIADO",
  ],
  AUTORIZADO: [],
  NO_AUTORIZADO: [],
  DEVUELTA: [],
});

export function canTransition(from: Estado, to: Estado): boolean {
  return ALLOWED[from].includes(to);
}

/** Terminal states reject further transitions — exposed for handlers that want
 *  to short-circuit (e.g. resend) before hitting the DB. */
export const TERMINAL_ESTADOS: readonly Estado[] = Object.freeze([
  "AUTORIZADO",
  "NO_AUTORIZADO",
  "DEVUELTA",
  "ERROR_BUILD",
]);

export function isTerminal(estado: Estado): boolean {
  return TERMINAL_ESTADOS.includes(estado);
}

/**
 * Whether the document's terminal state demands a fresh emission with a
 * NEW `claveAcceso` (caller-side reissue) rather than a retry of the
 * existing pipeline.
 *
 * Per SPEC-0026 + PLAN-0026 §4 Phase 4:
 *   - AUTORIZADO: already final-good. A resend has no effect (idempotent
 *     no-op); we return false because no reissue is needed either.
 *   - NO_AUTORIZADO / DEVUELTA / ERROR_BUILD: caller MUST reissue with a
 *     new claveAcceso (new secuencial). The resend endpoint refuses with
 *     422 + `code:"reissue_required"` for this case.
 */
export const REISSUE_REQUIRED_ESTADOS: readonly Estado[] = Object.freeze([
  "NO_AUTORIZADO",
  "DEVUELTA",
  "ERROR_BUILD",
]);

export function requiresReissue(estado: Estado): boolean {
  return REISSUE_REQUIRED_ESTADOS.includes(estado);
}
