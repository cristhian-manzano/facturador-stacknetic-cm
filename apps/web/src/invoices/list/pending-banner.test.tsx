/**
 * Tests for `<PendingBanner />` (TASKS-0043 §1.4).
 *
 * Covers:
 *   - Renders nothing when there are no pending items.
 *   - Aggregates the count when there ARE pending items (uses the
 *     POLLABLE_SRI_ESTADOS set).
 *   - Clicking "Refrescar todas" fires one call per pending row.
 *   - The concurrency cap is honoured (max 3 in flight at any time).
 *   - `runWithConcurrency` swallows per-task errors (one bad row never
 *     starves the others).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { InvoiceListItem } from "@facturador/contracts/invoices";

import {
  PendingBanner,
  runWithConcurrency,
  PENDING_REFRESH_CONCURRENCY,
} from "./pending-banner.js";

function row(id: string, sriEstado: InvoiceListItem["sriEstado"] | null = null): InvoiceListItem {
  const base = {
    id,
    estado: "EMITIDO",
    fechaEmision: "2026-05-19",
    customerRazonSocial: "Cliente Demo",
    estab: "001",
    ptoEmi: "001",
    importeTotal: 115,
  } as unknown as InvoiceListItem;
  return sriEstado === null || sriEstado === undefined ? base : { ...base, sriEstado };
}

describe("<PendingBanner /> rendering", () => {
  it("renders nothing when no items are pending", () => {
    const items = [row("01HX8K0PYFA9B7Y1M2N3P4Q5R6", "AUTORIZADO")];
    render(<PendingBanner items={items} />);
    expect(screen.queryByTestId("pending-banner")).toBeNull();
  });

  it("renders an aggregate count when 3 items are pending", () => {
    const items = [
      row("01HX8K0PYFA9B7Y1M2N3P4Q5AA", "EN_PROCESO"),
      row("01HX8K0PYFA9B7Y1M2N3P4Q5BB", "RECIBIDA"),
      row("01HX8K0PYFA9B7Y1M2N3P4Q5CC", "ERROR_RED"),
      row("01HX8K0PYFA9B7Y1M2N3P4Q5DD", "AUTORIZADO"),
    ];
    render(<PendingBanner items={items} />);
    expect(screen.getByTestId("pending-banner")).toBeInTheDocument();
    expect(screen.getByTestId("pending-banner-message")).toHaveTextContent(/3/);
  });

  it("renders the singular form when exactly 1 is pending", () => {
    const items = [row("01HX8K0PYFA9B7Y1M2N3P4Q5AA", "EN_PROCESO")];
    render(<PendingBanner items={items} />);
    expect(screen.getByTestId("pending-banner-message")).toHaveTextContent(/1 factura/i);
  });
});

describe("<PendingBanner /> batch refresh", () => {
  it("clicking 'Refrescar todas' calls refreshFn once per pending item", async () => {
    const items = [row("a", "EN_PROCESO"), row("b", "EN_PROCESO"), row("c", "EN_PROCESO")];
    const refreshFn = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PendingBanner items={items} refreshFn={refreshFn} />);
    await user.click(screen.getByTestId("pending-banner-refresh"));
    expect(refreshFn).toHaveBeenCalledTimes(3);
    expect(refreshFn).toHaveBeenNthCalledWith(1, "a");
    expect(refreshFn).toHaveBeenNthCalledWith(2, "b");
    expect(refreshFn).toHaveBeenNthCalledWith(3, "c");
  });

  it("disables the button while running and calls onBatchDone afterward", async () => {
    const items = [row("a", "EN_PROCESO")];
    let resolve!: () => void;
    const refreshFn = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const onBatchDone = vi.fn();
    const user = userEvent.setup();
    render(<PendingBanner items={items} refreshFn={refreshFn} onBatchDone={onBatchDone} />);
    await user.click(screen.getByTestId("pending-banner-refresh"));
    expect(screen.getByTestId("pending-banner-refresh")).toBeDisabled();
    resolve();
    await waitFor(() => {
      expect(onBatchDone).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a per-row spinner for each pending invoice while its refresh is in flight", async () => {
    const items = [
      row("aaaaaa", "EN_PROCESO"),
      row("bbbbbb", "EN_PROCESO"),
      row("cccccc", "EN_PROCESO"),
    ];
    // Hold all three refresh calls open until the assertions on the
    // spinners run. We capture the resolvers per call.
    const resolvers: (() => void)[] = [];
    const refreshFn = vi.fn(
      (): Promise<void> => new Promise<void>((r) => resolvers.push(r)),
    );
    const user = userEvent.setup();
    render(<PendingBanner items={items} refreshFn={refreshFn} />);
    await user.click(screen.getByTestId("pending-banner-refresh"));
    // While the calls are in flight, 3 spinners render.
    await waitFor(() => {
      expect(screen.getAllByTestId(/pending-row-spinner-/)).toHaveLength(3);
    });
    expect(screen.getByTestId("pending-row-spinner-aaaaaa")).toBeInTheDocument();
    expect(screen.getByTestId("pending-row-spinner-bbbbbb")).toBeInTheDocument();
    expect(screen.getByTestId("pending-row-spinner-cccccc")).toBeInTheDocument();
    // Resolve all three; spinners clear.
    resolvers.forEach((r) => r());
    await waitFor(() => {
      expect(screen.queryAllByTestId(/pending-row-spinner-/)).toHaveLength(0);
    });
  });
});

describe("runWithConcurrency", () => {
  it("never exceeds the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 9 }, () => () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          inFlight--;
          resolve();
        }, 5);
      });
    });
    await runWithConcurrency(tasks, PENDING_REFRESH_CONCURRENCY);
    expect(peak).toBeLessThanOrEqual(PENDING_REFRESH_CONCURRENCY);
  });

  it("swallows per-task errors and forwards them to onError", async () => {
    const errors: unknown[] = [];
    const tasks = [
      async () => {
        throw new Error("boom");
      },
      async () => {
        // ok
      },
    ];
    await runWithConcurrency(tasks, 2, (e) => errors.push(e));
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("boom");
  });

  it("throws if concurrency < 1", async () => {
    await expect(runWithConcurrency([], 0)).rejects.toThrow(/concurrency/);
  });
});
