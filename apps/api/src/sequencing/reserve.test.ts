/**
 * Tests for `reserveSecuencial` — single-thread monotonicity, retry
 * exhaustion, and overflow.
 *
 * Concurrent / Serializable behaviour lives in `test/establecimientos.test.ts`
 * — that file exercises real Postgres because Prisma's mock surface does
 * not model SQLSTATE 40001 conflicts. The tests here run against a fake
 * `prisma.$transaction` that simulates serialization conflicts so we can
 * verify the retry budget without the Postgres cost.
 */
import { describe, it, expect, vi } from "vitest";
import { ConflictError } from "@facturador/utils/errors";
import { reserveSecuencial, type ReserveSecuencialDeps } from "./reserve.js";

interface FakePrismaOptions {
  /** Pre-seed the counter for the (defaulted) key. */
  initialValue?: number;
  /** How many times $transaction should throw with the conflict before succeeding. */
  conflictAttempts?: number;
  /** Code to throw on conflict ('40001' or 'P2034'). */
  conflictCode?: string;
  /** Force a permanent error instead of a conflict. */
  permanentError?: Error;
  /** Override the post-increment value returned for the next call. */
  forcedReturnValue?: number;
}

interface FakeState {
  value: number;
  attempts: number;
  commits: number;
}

interface FakeTx {
  $queryRaw: <U>() => Promise<U>;
}

/** A no-op `sleep` to keep the unit tests instantaneous. */
const noSleep = (): Promise<void> => Promise.resolve();

function makeFakePrisma(opts: FakePrismaOptions = {}): {
  prisma: ReserveSecuencialDeps["prisma"];
  state: FakeState;
} {
  const state: FakeState = {
    value: opts.initialValue ?? 0,
    attempts: 0,
    commits: 0,
  };
  const conflictCount = opts.conflictAttempts ?? 0;
  const conflictCode = opts.conflictCode ?? "40001";

  const $transaction = async <T>(cb: (tx: FakeTx) => Promise<T>): Promise<T> => {
    state.attempts += 1;
    if (opts.permanentError !== undefined) {
      throw opts.permanentError;
    }
    if (state.attempts <= conflictCount) {
      const err = new Error("serialization_failure") as Error & {
        code: string;
      };
      err.code = conflictCode;
      throw err;
    }
    const tx: FakeTx = {
      $queryRaw: <U>() => {
        if (opts.forcedReturnValue !== undefined) {
          return Promise.resolve([{ next: BigInt(opts.forcedReturnValue) }] as unknown as U);
        }
        state.value += 1;
        return Promise.resolve([{ next: BigInt(state.value) }] as unknown as U);
      },
    };
    const result = await cb(tx);
    state.commits += 1;
    return result;
  };

  const prisma = { $transaction } as unknown as ReserveSecuencialDeps["prisma"];

  return { prisma, state };
}

const args = {
  companyId: "01J0COMPANY",
  estab: "001",
  ptoEmi: "001",
  tipoComprobante: "01",
};

describe("reserveSecuencial — single-worker monotonicity", () => {
  it("returns 000000001..000000005 in sequence for five reservations", async () => {
    const { prisma } = makeFakePrisma();
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await reserveSecuencial({ prisma, sleep: noSleep }, args));
    }
    expect(results).toEqual(["000000001", "000000002", "000000003", "000000004", "000000005"]);
  });

  it("pads with leading zeros to 9 chars (boundary check)", async () => {
    const { prisma } = makeFakePrisma({ forcedReturnValue: 42 });
    const value = await reserveSecuencial({ prisma, sleep: noSleep }, args);
    expect(value).toBe("000000042");
    expect(value).toHaveLength(9);
  });
});

describe("reserveSecuencial — Serializable retry budget", () => {
  it("retries up to maxRetries on a 40001 conflict and eventually succeeds", async () => {
    const sleepSpy = vi.fn((): Promise<void> => Promise.resolve());
    const { prisma, state } = makeFakePrisma({ conflictAttempts: 2 });
    const value = await reserveSecuencial({ prisma, sleep: sleepSpy, maxRetries: 3 }, args);
    expect(value).toBe("000000001");
    // 3 attempts total: 2 conflicts + 1 success.
    expect(state.attempts).toBe(3);
    // 2 sleeps because two conflicts means we waited between attempt 1→2 and 2→3.
    expect(sleepSpy).toHaveBeenCalledTimes(2);
  });

  it("retries on Prisma P2034 (Transaction failed) as well as 40001", async () => {
    const { prisma } = makeFakePrisma({
      conflictAttempts: 1,
      conflictCode: "P2034",
    });
    const value = await reserveSecuencial({ prisma, sleep: noSleep, maxRetries: 3 }, args);
    expect(value).toBe("000000001");
  });

  it("throws ConflictError(secuencial.exhausted_retries) once the budget is exhausted", async () => {
    const { prisma } = makeFakePrisma({ conflictAttempts: 5 });
    await expect(
      reserveSecuencial({ prisma, sleep: noSleep, maxRetries: 3 }, args),
    ).rejects.toMatchObject({
      code: "secuencial.exhausted_retries",
      status: 409,
    });
  });
});

describe("reserveSecuencial — non-conflict errors short-circuit", () => {
  it("a permanent error (P2002 unique violation) is rethrown unchanged", async () => {
    const permanentError = Object.assign(new Error("unique"), { code: "P2002" });
    const { prisma } = makeFakePrisma({ permanentError });
    await expect(reserveSecuencial({ prisma, sleep: noSleep }, args)).rejects.toThrow("unique");
  });
});

describe("reserveSecuencial — overflow", () => {
  it("throws ConflictError(invoice.sequential_overflow) when the next value exceeds 999_999_999", async () => {
    const { prisma } = makeFakePrisma({ forcedReturnValue: 1_000_000_000 });
    await expect(reserveSecuencial({ prisma, sleep: noSleep }, args)).rejects.toMatchObject({
      code: "invoice.sequential_overflow",
      status: 409,
    });
  });

  it("overflow is permanent — it does NOT consume the retry budget", async () => {
    const sleepSpy = vi.fn((): Promise<void> => Promise.resolve());
    const { prisma } = makeFakePrisma({ forcedReturnValue: 1_000_000_000 });
    await expect(
      reserveSecuencial({ prisma, sleep: sleepSpy, maxRetries: 3 }, args),
    ).rejects.toMatchObject({ code: "invoice.sequential_overflow" });
    // No retries — sleep was never called.
    expect(sleepSpy).not.toHaveBeenCalled();
  });
});

describe("reserveSecuencial — error type guard preserves ConflictError instance", () => {
  it("the thrown error is a ConflictError (instanceof + .code present)", async () => {
    const { prisma } = makeFakePrisma({ conflictAttempts: 5 });
    let captured: unknown;
    try {
      await reserveSecuencial({ prisma, sleep: noSleep, maxRetries: 1 }, args);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(ConflictError);
  });
});
