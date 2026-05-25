/**
 * `withRetry` — bounded retry wrapper used by both SOAP client classes.
 *
 * Policy (locked by SPEC-0025 §FR-4 + PLAN-0025 §3 + TASKS-0025 §4.1):
 *
 *   - `schedule = [1000, 2000, 4000, 8000, 16000]` ms (exponential).
 *   - Jitter of ±200 ms added to every delay so a synchronised retry
 *     storm from a fleet of workers spreads.
 *   - Total elapsed time capped by `budgetMs` (default 30 s). If the
 *     next delay would push us past the cap, we throw
 *     `SriRetryBudgetExceededError` instead of sleeping.
 *   - The decision "is this transient?" is delegated to `isTransient`
 *     — the wrapper does NOT classify HTTP status codes. The HTTP layer
 *     classifies transport throws; the client layer classifies status
 *     5xx (via its own predicate and a synthesised `SriClientError`).
 *   - The first attempt is NOT delayed. Subsequent attempts wait
 *     `schedule[attempt-1] ± jitter`.
 *   - On a non-transient throw we propagate immediately. On a transient
 *     throw with no schedule entries left, we propagate the final cause.
 *
 * Hard rule (PROMPT-0025 §6): never retry on a successful HTTP 200
 * carrying a business rejection (DEVUELTA / NO_AUTORIZADO). The client
 * classes implement that by *resolving* on a business outcome — the
 * caller of `withRetry` only re-runs on throws.
 *
 * The wrapper itself takes a `Clock` and `Sleep` seam so tests can
 * fast-forward time without burning real ms.
 */
import { SriClientError, SriRetryBudgetExceededError } from "./errors.js";

/** Default backoff schedule in milliseconds. Re-exported for the docs/test suite. */
export const DEFAULT_RETRY_SCHEDULE_MS: readonly number[] = Object.freeze([
  1_000, 2_000, 4_000, 8_000, 16_000,
]);

/** Default overall budget. The schedule is 31 s but with jitter we cap a touch higher. */
export const DEFAULT_RETRY_BUDGET_MS = 32_000;

/** Default jitter window. The value is positive — the wrapper picks `±jitter`. */
export const DEFAULT_RETRY_JITTER_MS = 200;

export interface WithRetryOptions {
  /** Backoff schedule in ms. Defaults to {@link DEFAULT_RETRY_SCHEDULE_MS}. */
  readonly schedule?: readonly number[];
  /** Total budget in ms across all attempts + sleeps. */
  readonly budgetMs?: number;
  /** Jitter window in ms (added/subtracted from each delay). */
  readonly jitterMs?: number;
  /**
   * Predicate that decides whether a thrown error should burn a retry.
   * Defaults to checking the `transient` flag on `SriClientError`.
   */
  readonly isTransient?: (err: unknown) => boolean;
  /** Clock override (test seam). Returns ms-since-epoch. */
  readonly now?: () => number;
  /** Sleep override (test seam). Resolves after `ms` ms. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** RNG override (test seam). Must return a value in [0, 1). */
  readonly random?: () => number;
  /** Optional observer — invoked after every attempt. Useful for telemetry. */
  readonly onAttempt?: (info: RetryAttemptInfo) => void;
}

export interface RetryAttemptInfo {
  /** 1-based attempt number. */
  readonly attempt: number;
  /** Whether the attempt succeeded. */
  readonly ok: boolean;
  /** Delay in ms scheduled before the NEXT attempt (0 on the last). */
  readonly delayMs: number;
  /** Total elapsed time so far across attempts + sleeps. */
  readonly elapsedMs: number;
  /** Error from this attempt (when `ok === false`). */
  readonly error?: unknown;
}

const defaultIsTransient = (err: unknown): boolean =>
  err instanceof SriClientError && err.transient;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function computeJitteredDelay(base: number, jitter: number, random: () => number): number {
  // Uniform jitter in [-jitter, +jitter] — clamped so we never return < 0.
  const offset = (random() * 2 - 1) * jitter;
  return Math.max(0, Math.floor(base + offset));
}

/**
 * Run `fn` with bounded retries. The wrapper never swallows the throw — it
 * either resolves with `fn`'s value or rejects with the last observed
 * error (wrapping budget exhaustion in `SriRetryBudgetExceededError`).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: WithRetryOptions = {},
): Promise<T> {
  const schedule = options.schedule ?? DEFAULT_RETRY_SCHEDULE_MS;
  const budgetMs = options.budgetMs ?? DEFAULT_RETRY_BUDGET_MS;
  const jitterMs = options.jitterMs ?? DEFAULT_RETRY_JITTER_MS;
  const isTransient = options.isTransient ?? defaultIsTransient;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  const startedAt = now();
  // Attempts == schedule.length + 1 — first attempt + one retry per slot.
  const maxAttempts = schedule.length + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn(attempt);
      options.onAttempt?.({
        attempt,
        ok: true,
        delayMs: 0,
        elapsedMs: now() - startedAt,
      });
      return value;
    } catch (err) {
      lastError = err;
      const elapsedMs = now() - startedAt;

      // Non-transient → fail fast, no retry.
      if (!isTransient(err)) {
        options.onAttempt?.({ attempt, ok: false, delayMs: 0, elapsedMs, error: err });
        throw err;
      }

      // Out of attempts → propagate the last cause as-is. (We deliberately
      // do not wrap a transient throw in a "budget exceeded" error when the
      // schedule slot is the cause of termination — that's an attempt-count
      // exhaustion, not a budget exhaustion.)
      if (attempt === maxAttempts) {
        options.onAttempt?.({ attempt, ok: false, delayMs: 0, elapsedMs, error: err });
        throw err;
      }

      const baseDelay = schedule[attempt - 1] ?? 0;
      const delayMs = computeJitteredDelay(baseDelay, jitterMs, random);

      // Budget check — would sleeping push us past the cap?
      if (elapsedMs + delayMs > budgetMs) {
        const budgetErr = new SriRetryBudgetExceededError("SRI retry budget exceeded", {
          cause: err,
        });
        options.onAttempt?.({ attempt, ok: false, delayMs, elapsedMs, error: budgetErr });
        throw budgetErr;
      }

      options.onAttempt?.({ attempt, ok: false, delayMs, elapsedMs, error: err });
      await sleep(delayMs);
    }
  }

  // Defensive — the loop only exits via return/throw above.
  throw lastError ?? new Error("withRetry: exhausted without resolution");
}
