/**
 * Shared in-memory polling-health surface.
 *
 * The scheduler stamps `recordBatchCompleted(now)` after each successful
 * `runPollBatch` invocation; the `/readyz` route reads
 * `lastBatchAtMs(now)` to decide whether the polling subsystem is
 * stale.
 *
 * Source of truth: audit-punchlist Item 12 (REVIEW-0026 §10 #4).
 *
 * Production note: this state lives in-process. A multi-replica
 * deployment should reach `/readyz` per pod — each pod has its own
 * scheduler, so each `/readyz` reflects only the local scheduler's
 * health.
 */

/**
 * Mutable polling health holder. The default singleton lives in
 * `getDefaultPollingHealth()`; tests pass their own instance.
 */
export interface PollingHealthState {
  recordBatchCompleted(atMs?: number): void;
  /** Returns the last batch completion timestamp in epoch ms, or null when no batch has finished yet. */
  lastBatchAtMs(): number | null;
}

/**
 * Build a fresh, isolated polling-health holder. Tests use this so
 * each suite has its own clock-driven state.
 */
export function createPollingHealth(): PollingHealthState {
  let last: number | null = null;
  return {
    recordBatchCompleted(atMs?: number) {
      last = atMs ?? Date.now();
    },
    lastBatchAtMs() {
      return last;
    },
  };
}

let defaultState: PollingHealthState | null = null;

/** Module-default singleton. Lazily constructed on first read. */
export function getDefaultPollingHealth(): PollingHealthState {
  defaultState ??= createPollingHealth();
  return defaultState;
}

/** Test seam — reset the singleton between suites. */
export function _resetDefaultPollingHealthForTests(): void {
  defaultState = null;
}

/**
 * The maximum age a "last batch" can be before `/readyz` reports the
 * subsystem as stale. Default 5 minutes (per the audit punchlist).
 */
export const POLLING_STALENESS_THRESHOLD_MS = 5 * 60 * 1000;
