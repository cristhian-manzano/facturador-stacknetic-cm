/**
 * Exhaustive matrix tests for `canTransition` per SPEC-0026 §6.2.
 *
 * For every (from, to) pair we assert the matrix prediction matches the
 * spec table. We also assert terminal states have zero outgoing edges and
 * that `ERROR_RED` self-loop is allowed (retry bookkeeping).
 */
import { describe, expect, it } from "vitest";
import { SriEstado } from "@facturador/db";
import { ALLOWED, TERMINAL_ESTADOS, canTransition, isTerminal } from "./transitions.js";

const ESTADOS = Object.values(SriEstado);

describe("ALLOWED matrix", () => {
  it("declares an entry for every SriEstado value", () => {
    for (const e of ESTADOS) {
      expect(ALLOWED[e]).toBeDefined();
    }
  });

  it("terminal estados have empty outgoing edges", () => {
    for (const e of TERMINAL_ESTADOS) {
      expect(ALLOWED[e]).toEqual([]);
    }
  });
});

describe("canTransition — table-driven", () => {
  const tableEntries: Array<{ from: SriEstado; to: SriEstado; expected: boolean }> = [];
  for (const from of ESTADOS) {
    for (const to of ESTADOS) {
      tableEntries.push({
        from,
        to,
        expected: ALLOWED[from].includes(to),
      });
    }
  }

  it.each(tableEntries)("$from → $to is $expected", ({ from, to, expected }) => {
    expect(canTransition(from, to)).toBe(expected);
  });
});

describe("canTransition — key happy paths", () => {
  it("PENDIENTE → FIRMADO", () => {
    expect(canTransition("PENDIENTE", "FIRMADO")).toBe(true);
  });
  it("FIRMADO → ENVIADO", () => {
    expect(canTransition("FIRMADO", "ENVIADO")).toBe(true);
  });
  it("ENVIADO → RECIBIDA", () => {
    expect(canTransition("ENVIADO", "RECIBIDA")).toBe(true);
  });
  it("RECIBIDA → AUTORIZADO", () => {
    expect(canTransition("RECIBIDA", "AUTORIZADO")).toBe(true);
  });
  it("RECIBIDA → EN_PROCESO", () => {
    expect(canTransition("RECIBIDA", "EN_PROCESO")).toBe(true);
  });
  it("EN_PROCESO → AUTORIZADO", () => {
    expect(canTransition("EN_PROCESO", "AUTORIZADO")).toBe(true);
  });
});

describe("canTransition — illegal jumps", () => {
  it("PENDIENTE → AUTORIZADO is rejected (must go through FIRMADO → ENVIADO → RECIBIDA)", () => {
    expect(canTransition("PENDIENTE", "AUTORIZADO")).toBe(false);
  });
  it("AUTORIZADO is a terminal — cannot transition anywhere", () => {
    for (const to of ESTADOS) {
      expect(canTransition("AUTORIZADO", to)).toBe(false);
    }
  });
  it("DEVUELTA is a terminal — cannot transition anywhere", () => {
    for (const to of ESTADOS) {
      expect(canTransition("DEVUELTA", to)).toBe(false);
    }
  });
  it("ENVIADO cannot jump back to PENDIENTE", () => {
    expect(canTransition("ENVIADO", "PENDIENTE")).toBe(false);
  });
});

describe("ERROR_RED retry semantics", () => {
  it("allows ERROR_RED → ERROR_RED (retry bookkeeping)", () => {
    expect(canTransition("ERROR_RED", "ERROR_RED")).toBe(true);
  });
  it("allows ERROR_RED → AUTORIZADO (polling-job success after a network error)", () => {
    expect(canTransition("ERROR_RED", "AUTORIZADO")).toBe(true);
  });
});

describe("isTerminal", () => {
  it("returns true for AUTORIZADO / NO_AUTORIZADO / DEVUELTA / ERROR_BUILD", () => {
    expect(isTerminal("AUTORIZADO")).toBe(true);
    expect(isTerminal("NO_AUTORIZADO")).toBe(true);
    expect(isTerminal("DEVUELTA")).toBe(true);
    expect(isTerminal("ERROR_BUILD")).toBe(true);
  });
  it("returns false for transient states", () => {
    expect(isTerminal("PENDIENTE")).toBe(false);
    expect(isTerminal("FIRMADO")).toBe(false);
    expect(isTerminal("EN_PROCESO")).toBe(false);
    expect(isTerminal("ERROR_RED")).toBe(false);
  });
});
