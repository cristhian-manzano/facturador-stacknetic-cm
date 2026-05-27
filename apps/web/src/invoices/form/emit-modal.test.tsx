/**
 * `EmitModal` + reducer + helpers tests
 * (SPEC-0042 §FR-7 / §6.5 / TASKS-0042 §2.7).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api.js";

import {
  EmitModal,
  EMIT_MODAL_INITIAL,
  emitErrorToAction,
  emitModalReducer,
  emitResponseToAction,
  useEmitModal,
} from "./emit-modal.js";


describe("emitModalReducer — state machine", () => {
  it("idle → submitting on submit", () => {
    const next = emitModalReducer(EMIT_MODAL_INITIAL, { type: "submit" });
    expect(next.status).toBe("submitting");
  });

  it("submitting → success with response", () => {
    const start = emitModalReducer(EMIT_MODAL_INITIAL, { type: "submit" });
    const next = emitModalReducer(start, {
      type: "success",
      response: {
        estado: "AUTORIZADO",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        claveAcceso: "1".repeat(49) as any,
        mensajes: [],
      },
    });
    expect(next.status).toBe("success");
    expect(next.response?.estado).toBe("AUTORIZADO");
  });

  it("submitting → business_error with mensajes", () => {
    const start = emitModalReducer(EMIT_MODAL_INITIAL, { type: "submit" });
    const next = emitModalReducer(start, {
      type: "business_error",
      mensajes: [{ identificador: "RUC", mensaje: "inválido", tipo: "ERROR" }],
    });
    expect(next.status).toBe("business_error");
    expect(next.mensajes).toHaveLength(1);
  });

  it("submitting → network_error", () => {
    const start = emitModalReducer(EMIT_MODAL_INITIAL, { type: "submit" });
    const next = emitModalReducer(start, { type: "network_error" });
    expect(next.status).toBe("network_error");
  });

  it("reset returns to initial", () => {
    const start = emitModalReducer(EMIT_MODAL_INITIAL, { type: "submit" });
    expect(emitModalReducer(start, { type: "reset" })).toEqual(EMIT_MODAL_INITIAL);
  });

  it("expand toggles the expanded flag", () => {
    const next = emitModalReducer(EMIT_MODAL_INITIAL, { type: "expand" });
    expect(next.expanded).toBe(true);
  });
});

describe("emitErrorToAction", () => {
  it("network.unexpected → network_error", () => {
    const err = new ApiError({
      type: "about:blank",
      title: "down",
      status: 0,
      code: "network.unexpected",
    });
    expect(emitErrorToAction(err).type).toBe("network_error");
  });
  it("500 → network_error", () => {
    const err = new ApiError({
      type: "about:blank",
      title: "boom",
      status: 500,
      code: "internal",
    });
    expect(emitErrorToAction(err).type).toBe("network_error");
  });
  it("422 with mensajes → business_error", () => {
    const err = new ApiError({
      type: "about:blank",
      title: "rejected",
      status: 422,
      code: "sri.devuelta",
      errors: [{ identificador: "RUC", mensaje: "bad ruc", tipo: "ERROR" }],
    });
    const action = emitErrorToAction(err);
    expect(action.type).toBe("business_error");
    if (action.type === "business_error") expect(action.mensajes).toHaveLength(1);
  });
  it("422 with no mensajes → business_error with synthetic row", () => {
    const err = new ApiError({
      type: "about:blank",
      title: "rejected",
      status: 422,
      code: "payments_mismatch",
    });
    const action = emitErrorToAction(err);
    expect(action.type).toBe("business_error");
    if (action.type === "business_error") expect(action.mensajes).toHaveLength(1);
  });
  it("non-ApiError → network_error", () => {
    expect(emitErrorToAction(new Error("?")).type).toBe("network_error");
  });
});

describe("emitResponseToAction", () => {
  it("AUTORIZADO → success", () => {
    expect(
      emitResponseToAction({
        estado: "AUTORIZADO",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        claveAcceso: "x" as any,
      }).type,
    ).toBe("success");
  });
  it("EN_PROCESO → success", () => {
    expect(
      emitResponseToAction({
        estado: "EN_PROCESO",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        claveAcceso: "x" as any,
      }).type,
    ).toBe("success");
  });
  it("ERROR_RED → network_error", () => {
    expect(
      emitResponseToAction({
        estado: "ERROR_RED",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        claveAcceso: "x" as any,
      }).type,
    ).toBe("network_error");
  });
  it("DEVUELTA → business_error", () => {
    expect(
      emitResponseToAction({
        estado: "DEVUELTA",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        claveAcceso: "x" as any,
        mensajes: [{ identificador: "x", mensaje: "y", tipo: "ERROR" }],
      }).type,
    ).toBe("business_error");
  });
});

// Mini wrapper that drives the modal through its lifecycle.
// IMPORTANT: callbacks are stable identities so the modal's useEffects
// don't re-fire on every render and reschedule timers.
import { useCallback } from "react";

function ModalHarness(props: {
  onClose?: () => void;
  onRetry?: () => void;
  onSuccessRedirect?: () => void;
}): ReactElement {
  const { state, dispatch } = useEmitModal();
  const onClose = props.onClose ?? noop;
  const onRetry = props.onRetry ?? noop;
  const onSuccessRedirect = props.onSuccessRedirect ?? noop;
  const submit = useCallback(() => { dispatch({ type: "submit" }); }, [dispatch]);
  const ok = useCallback(
    () =>
      { dispatch({
        type: "success",
        response: {
          estado: "AUTORIZADO",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          claveAcceso: "x" as any,
        },
      }); },
    [dispatch],
  );
  const biz = useCallback(
    () =>
      { dispatch({
        type: "business_error",
        mensajes: Array.from({ length: 7 }, (_, i) => ({
          identificador: `E${(i + 1).toString()}`,
          mensaje: `msg ${(i + 1).toString()}`,
          tipo: "ERROR",
        })),
      }); },
    [dispatch],
  );
  const net = useCallback(() => { dispatch({ type: "network_error" }); }, [dispatch]);
  return (
    <>
      <button type="button" onClick={submit}>
        submit
      </button>
      <button type="button" onClick={ok}>
        ok
      </button>
      <button type="button" onClick={biz}>
        biz
      </button>
      <button type="button" onClick={net}>
        net
      </button>
      <EmitModal
        open={true}
        state={state}
        dispatch={dispatch}
        onClose={onClose}
        onRetry={onRetry}
        onSuccessRedirect={onSuccessRedirect}
      />
    </>
  );
}

function noop(): void {
  /* intentional */
}

describe("<EmitModal>", () => {
  it("renders dialog with aria roles + label", () => {
    render(<ModalHarness />);
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveAttribute("aria-modal", "true");
    expect(dlg).toHaveAccessibleName(/Procesando con el SRI/);
  });

  it("submitting state: cancel is disabled", () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByText("submit"));
    expect(screen.getByTestId("emit-modal-submitting")).toBeInTheDocument();
    expect(screen.getByTestId("emit-modal-cancel")).toBeDisabled();
  });

  it("success state: shows AUTORIZADO banner and auto-redirects after 400ms", () => {
    vi.useFakeTimers();
    const onSuccessRedirect = vi.fn();
    render(<ModalHarness onSuccessRedirect={onSuccessRedirect} />);
    act(() => {
      fireEvent.click(screen.getByText("ok"));
    });
    expect(screen.getByTestId("emit-modal-success")).toHaveTextContent(/AUTORIZADA/);
    expect(onSuccessRedirect).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onSuccessRedirect).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("business_error: shows mensajes (max 5 visible, Ver más expands)", () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByText("biz"));
    expect(screen.getAllByTestId("emit-mensaje")).toHaveLength(5);
    const showMore = screen.getByText(/Ver más/);
    fireEvent.click(showMore);
    expect(screen.getAllByTestId("emit-mensaje")).toHaveLength(7);
  });

  it("business_error: 'Corregir y reenviar' closes the modal", () => {
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />);
    fireEvent.click(screen.getByText("biz"));
    fireEvent.click(screen.getByTestId("emit-modal-correct"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("network_error: 'Reintentar' fires onRetry", () => {
    const onRetry = vi.fn();
    render(<ModalHarness onRetry={onRetry} />);
    fireEvent.click(screen.getByText("net"));
    fireEvent.click(screen.getByTestId("emit-modal-retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
