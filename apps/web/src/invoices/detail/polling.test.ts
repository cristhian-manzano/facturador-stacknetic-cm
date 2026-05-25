/**
 * Tests for the polling constants module (SPEC-0043 §FR-2 + TASKS-0043
 * §3.1).
 *
 * Hard rule pinned here: tests MUST import the constants, never
 * re-declare them as magic numbers.
 */
import { describe, expect, it } from "vitest";

import {
  POLLABLE_SRI_ESTADOS,
  POLL_INTERVAL_MS,
  POLL_MAX_DURATION_MS,
  isPollableEstado,
  shouldKeepPolling,
} from "./polling.js";

describe("polling constants", () => {
  it("POLL_INTERVAL_MS is 5 seconds", () => {
    expect(POLL_INTERVAL_MS).toBe(5_000);
  });

  it("POLL_MAX_DURATION_MS is 5 minutes", () => {
    expect(POLL_MAX_DURATION_MS).toBe(5 * 60 * 1000);
  });

  it("POLLABLE_SRI_ESTADOS is the canonical {EN_PROCESO, RECIBIDA, ERROR_RED} set", () => {
    expect(POLLABLE_SRI_ESTADOS).toEqual(["EN_PROCESO", "RECIBIDA", "ERROR_RED"]);
  });
});

describe("isPollableEstado", () => {
  it("returns true for each pollable estado", () => {
    for (const e of POLLABLE_SRI_ESTADOS) {
      expect(isPollableEstado(e)).toBe(true);
    }
  });

  it("returns false for null and undefined", () => {
    expect(isPollableEstado(null)).toBe(false);
    expect(isPollableEstado(undefined)).toBe(false);
  });

  it("returns false for terminal SRI estados", () => {
    expect(isPollableEstado("AUTORIZADO")).toBe(false);
    expect(isPollableEstado("DEVUELTA")).toBe(false);
    expect(isPollableEstado("NO_AUTORIZADO")).toBe(false);
    expect(isPollableEstado("ENVIADO")).toBe(false);
    expect(isPollableEstado("PENDIENTE")).toBe(false);
    expect(isPollableEstado("FIRMADO")).toBe(false);
    expect(isPollableEstado("ERROR_BUILD")).toBe(false);
  });
});

describe("shouldKeepPolling", () => {
  it("returns POLL_INTERVAL_MS on first call (pollStartedAt=null) when estado is pollable", () => {
    expect(
      shouldKeepPolling({
        sriEstado: "EN_PROCESO",
        pollStartedAt: null,
        now: 1000,
      }),
    ).toBe(POLL_INTERVAL_MS);
  });

  it("returns POLL_INTERVAL_MS while within the 5-minute cap", () => {
    const start = 1000;
    expect(
      shouldKeepPolling({
        sriEstado: "RECIBIDA",
        pollStartedAt: start,
        now: start + POLL_MAX_DURATION_MS - 1,
      }),
    ).toBe(POLL_INTERVAL_MS);
  });

  it("returns false when the 5-minute cap is reached", () => {
    const start = 1000;
    expect(
      shouldKeepPolling({
        sriEstado: "EN_PROCESO",
        pollStartedAt: start,
        now: start + POLL_MAX_DURATION_MS,
      }),
    ).toBe(false);
    expect(
      shouldKeepPolling({
        sriEstado: "EN_PROCESO",
        pollStartedAt: start,
        now: start + POLL_MAX_DURATION_MS + 1,
      }),
    ).toBe(false);
  });

  it("returns false for any non-pollable estado, regardless of clocks", () => {
    expect(
      shouldKeepPolling({
        sriEstado: "AUTORIZADO",
        pollStartedAt: null,
        now: 0,
      }),
    ).toBe(false);
    expect(
      shouldKeepPolling({
        sriEstado: null,
        pollStartedAt: 1,
        now: 2,
      }),
    ).toBe(false);
  });
});
