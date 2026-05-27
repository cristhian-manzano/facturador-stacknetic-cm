/**
 * Tests for `@facturador/utils/context`.
 *
 * The three invariants the rest of the codebase relies on:
 *
 *   1. Nested `runWithContext` shadows but does NOT clobber the outer
 *      scope. When the inner callback returns, `getContext()` again
 *      reports the outer ctx. (Verified by reading inside + after.)
 *   2. Async continuations preserve the binding. We `await` a promise
 *      that resolves on a microtask AND on a `setTimeout` macrotask, and
 *      assert the binding is still there in both.
 *   3. `getContext()` returns `undefined` outside any scope; the bare
 *      `requireContext()` throws.
 *
 * NOT tested here (intentional):
 *   - Express middleware integration — covered by `apps/api` tests.
 *   - `enterWith`/`disable` — not exposed; if someone reaches into the
 *     internal `AsyncLocalStorage` to break the contract, that's a
 *     review concern, not a unit-test concern.
 */
import { describe, expect, it } from "vitest";

import { getContext, requireContext, runWithContext, type RequestContext } from "./index.js";

const ctxA: RequestContext = { requestId: "req-A" };
const ctxB: RequestContext = { requestId: "req-B", companyId: "cmp-1" };

describe("runWithContext / getContext", () => {
  it("makes the ctx visible to the synchronous callback", () => {
    const seen = runWithContext(ctxA, () => getContext());
    expect(seen).toEqual(ctxA);
  });

  it("returns the value of fn unchanged", () => {
    const out = runWithContext(ctxA, () => 42);
    expect(out).toBe(42);
  });

  it("nested run shadows the outer ctx inside the inner scope", () => {
    runWithContext(ctxA, () => {
      expect(getContext()).toEqual(ctxA);
      runWithContext(ctxB, () => {
        expect(getContext()).toEqual(ctxB);
      });
      // Back to the outer ctx after the inner run exits.
      expect(getContext()).toEqual(ctxA);
    });
  });

  it("preserves the ctx across `await` (microtask continuation)", async () => {
    const result = await runWithContext(ctxA, async () => {
      // Yield to the microtask queue and re-check.
      await Promise.resolve();
      return getContext();
    });
    expect(result).toEqual(ctxA);
  });

  it("preserves the ctx across `setTimeout` (macrotask continuation)", async () => {
    const result = await runWithContext(ctxB, async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      return getContext();
    });
    expect(result).toEqual(ctxB);
  });

  it("preserves the ctx through chained promises", async () => {
    const collected: (RequestContext | undefined)[] = [];
    await runWithContext(ctxA, async () => {
      collected.push(getContext());
      await Promise.resolve().then(() => {
        collected.push(getContext());
      });
      await Promise.resolve();
      collected.push(getContext());
    });
    expect(collected).toEqual([ctxA, ctxA, ctxA]);
  });

  it("getContext() is undefined outside any run", () => {
    // Sanity check — assumes no leftover scope from previous test (vitest
    // runs each `it` on its own microtask root).
    expect(getContext()).toBeUndefined();
  });
});

describe("requireContext", () => {
  it("returns the ctx inside a run", () => {
    runWithContext(ctxA, () => {
      expect(requireContext()).toEqual(ctxA);
    });
  });

  it("throws outside any run", () => {
    expect(() => requireContext()).toThrow(/RequestContext is required/);
  });
});
