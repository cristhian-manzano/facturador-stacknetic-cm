/**
 * Polling constants for the invoice detail page (SPEC-0043 §FR-2 / TASKS-0043 §3).
 *
 * Hard rules pinned here:
 *
 *   - 5-second interval, 5-minute absolute cap.
 *   - Polls ONLY while `sriEstado ∈ {EN_PROCESO, RECIBIDA, ERROR_RED}`.
 *     Any other estado (including AUTORIZADO, NO_AUTORIZADO, DEVUELTA,
 *     PENDIENTE, FIRMADO, ENVIADO, ERROR_BUILD, or `null`) is terminal
 *     from the polling layer's perspective.
 *
 * Why constants? Tests MUST import these literals; magic numbers in the
 * detail file would let a stray edit drift below the 5 s lower bound or
 * above the 5 min upper bound without anyone noticing.
 *
 * Refs:
 *   - SPEC-0043 §6.4 ("Polling using TanStack Query `refetchInterval`
 *     when sriEstado in (EN_PROCESO, RECIBIDA, ERROR_RED); stops once
 *     terminal state reached.")
 *   - PLAN-0043 §3 ("Detail polls every 5 s when sriEstado ∈ {…},
 *     for up to 5 minutes; then stops.")
 *   - TASKS-0043 §3 ("Polling MUST be defined as constants … never inline").
 */
import type { SriEstado } from "@facturador/contracts/sri";

/** Poll interval in milliseconds. The interval is fixed (no backoff). */
export const POLL_INTERVAL_MS = 5_000;

/** Absolute polling cap (5 minutes). After this elapses since the FIRST
 * poll, `refetchInterval` returns `false` and no further polls fire. */
export const POLL_MAX_DURATION_MS = 300_000;

/**
 * The SRI estados that trigger polling. Anything outside this set is
 * treated as terminal (no more polls).
 *
 * Tight set, intentionally exclusive:
 *   - `EN_PROCESO` — SRI accepted but is still authorising.
 *   - `RECIBIDA` — SRI acknowledged receipt; authorisation pending.
 *   - `ERROR_RED` — transient network error from our side; we keep
 *     polling so the user sees recovery without manually clicking.
 */
export const POLLABLE_SRI_ESTADOS = ["EN_PROCESO", "RECIBIDA", "ERROR_RED"] as const;

export type PollableSriEstado = (typeof POLLABLE_SRI_ESTADOS)[number];

/**
 * Pure predicate: should polling continue for this sriEstado?
 *
 * Total: returns `false` for `null`/`undefined` and any non-pollable
 * estado. The caller never needs to defend against unknown values.
 */
export function isPollableEstado(sriEstado: SriEstado | null | undefined): boolean {
  if (sriEstado === null || sriEstado === undefined) return false;
  return (POLLABLE_SRI_ESTADOS as readonly string[]).includes(sriEstado);
}

/**
 * Decide whether to keep polling. Returns the next interval in ms,
 * or `false` to stop. The caller (TanStack Query) treats `false` as
 * "no further refetches".
 *
 * Pure: takes `now` and `pollStartedAt` so tests can pin both clocks
 * without faking `Date.now`.
 */
export function shouldKeepPolling(args: {
  sriEstado: SriEstado | null | undefined;
  pollStartedAt: number | null;
  now: number;
}): number | false {
  if (!isPollableEstado(args.sriEstado)) return false;
  // If we haven't started polling yet, kick off NOW.
  if (args.pollStartedAt === null) return POLL_INTERVAL_MS;
  const elapsed = args.now - args.pollStartedAt;
  if (elapsed >= POLL_MAX_DURATION_MS) return false;
  return POLL_INTERVAL_MS;
}
