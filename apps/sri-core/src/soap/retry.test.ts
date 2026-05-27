/**
 * Tests for `withRetry`.
 *
 * Asserts:
 *   - First-attempt success short-circuits and does NOT sleep.
 *   - Transient throws burn the schedule in order; observed sleep
 *     durations match `schedule[attempt-1] ± jitter`.
 *   - Non-transient throw propagates immediately (no retry).
 *   - Budget exceeded throws `SriRetryBudgetExceededError` BEFORE
 *     sleeping past the cap.
 *   - Final transient throw after the schedule is exhausted propagates
 *     the original error.
 *   - `onAttempt` observer fires for every attempt with correct fields.
 *
 * Source of truth:
 *   - SPEC-0025 §4 FR-4 (retry policy).
 *   - PLAN-0025 §4 Phase 5.
 *   - TASKS-0025 §4.1 (schedule + jitter + budget).
 */
import { describe, expect, it } from "vitest";

import { SriClientError, SriRetryBudgetExceededError } from "./errors.js";
import {
  withRetry,
  DEFAULT_RETRY_SCHEDULE_MS,
  DEFAULT_RETRY_BUDGET_MS,
  DEFAULT_RETRY_JITTER_MS,
  type RetryAttemptInfo,
} from "./retry.js";

function transient(msg = "boom"): SriClientError {
  return new SriClientError(msg, { kind: "network", transient: true });
}

function permanent(msg = "no"): SriClientError {
  return new SriClientError(msg, { kind: "http_4xx", transient: false });
}

/** Build a clock + sleep harness that advances time when `sleep` is called. */
function fakeClock() {
  let nowMs = 0;
  const sleeps: number[] = [];
  return {
    now: () => nowMs,
    sleep: (ms: number) => {
      sleeps.push(ms);
      nowMs += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
    sleeps,
  };
}

describe("withRetry — defaults", () => {
  it("exports the documented schedule + budget + jitter", () => {
    expect(DEFAULT_RETRY_SCHEDULE_MS).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(DEFAULT_RETRY_BUDGET_MS).toBe(32_000);
    expect(DEFAULT_RETRY_JITTER_MS).toBe(200);
  });
});

describe("withRetry — success paths", () => {
  it("returns the first-attempt value without sleeping", async () => {
    const clock = fakeClock();
    const result = await withRetry(async () => "ok", {
      sleep: clock.sleep,
      now: clock.now,
      random: () => 0.5,
    });
    expect(result).toBe("ok");
    expect(clock.sleeps).toEqual([]);
  });

  it("succeeds on the 3rd attempt after 2 transient throws", async () => {
    const clock = fakeClock();
    let attempts = 0;
    const result = await withRetry<string>(
      async () => {
        attempts++;
        if (attempts < 3) throw transient();
        return "ok";
      },
      {
        sleep: clock.sleep,
        now: clock.now,
        random: () => 0.5, // jitter = 0
      },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    // Two sleeps observed: schedule[0]=1000, schedule[1]=2000.
    expect(clock.sleeps).toEqual([1_000, 2_000]);
  });
});

describe("withRetry — schedule + jitter", () => {
  it("honours schedule[i] with jitter ±200 ms (random=0 ⇒ -jitter, random=1 ⇒ +jitter)", async () => {
    const clock = fakeClock();
    let attempts = 0;
    // random=0 → offset = -jitter (= -200). random=1 in the loop would be 1
    // but we approximate via 0.9999 to keep deterministic.
    const randomSequence = [0, 0.9999, 0, 0.9999];
    let i = 0;
    const random = () => randomSequence[i++ % randomSequence.length] ?? 0.5;

    await expect(
      withRetry<string>(
        async () => {
          attempts++;
          throw transient();
        },
        {
          schedule: [100, 200, 300, 400, 500],
          budgetMs: 5_000,
          jitterMs: 50,
          sleep: clock.sleep,
          now: clock.now,
          random,
        },
      ),
    ).rejects.toBeInstanceOf(SriClientError);
    // We don't care exactly which error — we just want the sleep arithmetic.
    expect(attempts).toBe(6); // 1 + schedule.length attempts.
    // Sleeps: [100-50, 200+~49, 300-50, 400+~49, 500-50]
    expect(clock.sleeps).toEqual([50, 249, 250, 449, 450]);
  });
});

describe("withRetry — non-transient errors", () => {
  it("propagates a non-transient error without retrying", async () => {
    const clock = fakeClock();
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw permanent();
        },
        { sleep: clock.sleep, now: clock.now },
      ),
    ).rejects.toBeInstanceOf(SriClientError);
    expect(attempts).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });
});

describe("withRetry — schedule exhaustion", () => {
  it("propagates the final transient throw when the schedule is exhausted", async () => {
    const clock = fakeClock();
    let attempts = 0;
    const finalErr = transient("final");
    await expect(
      withRetry(
        async () => {
          attempts++;
          if (attempts === 6) throw finalErr;
          throw transient(`attempt-${String(attempts)}`);
        },
        {
          schedule: [10, 10, 10, 10, 10],
          budgetMs: 60_000,
          jitterMs: 0,
          sleep: clock.sleep,
          now: clock.now,
          random: () => 0.5,
        },
      ),
    ).rejects.toBe(finalErr);
    expect(attempts).toBe(6); // 1 + 5 retries
  });
});

describe("withRetry — budget cap", () => {
  it("throws SriRetryBudgetExceededError BEFORE sleeping past the cap", async () => {
    const clock = fakeClock();
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw transient();
        },
        {
          schedule: [1_000, 5_000, 5_000, 5_000, 5_000],
          budgetMs: 1_500, // first sleep fits (1000ms), but the 2nd (5000) blows the cap
          jitterMs: 0,
          sleep: clock.sleep,
          now: clock.now,
          random: () => 0.5,
        },
      ),
    ).rejects.toBeInstanceOf(SriRetryBudgetExceededError);
    // Sleep happened once: 1000 ms; then the 2nd attempt would push to ~6000 > 1500 cap.
    expect(clock.sleeps).toEqual([1_000]);
    expect(attempts).toBe(2);
  });
});

describe("withRetry — observer", () => {
  it("calls onAttempt for every attempt with correct fields", async () => {
    const clock = fakeClock();
    const events: RetryAttemptInfo[] = [];
    let attempts = 0;
    await withRetry<string>(
      async () => {
        attempts++;
        if (attempts < 3) throw transient();
        return "ok";
      },
      {
        schedule: [100, 100, 100, 100, 100],
        budgetMs: 5_000,
        jitterMs: 0,
        sleep: clock.sleep,
        now: clock.now,
        random: () => 0.5,
        onAttempt: (e) => events.push(e),
      },
    );
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ attempt: 1, ok: false, delayMs: 100 });
    expect(events[1]).toMatchObject({ attempt: 2, ok: false, delayMs: 100 });
    expect(events[2]).toMatchObject({ attempt: 3, ok: true });
  });
});
