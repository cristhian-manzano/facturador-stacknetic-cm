/**
 * `EmitModal` — emit lifecycle modal (SPEC-0042 §FR-7 / §6.5 / TASKS-0042
 * §2.7).
 *
 * State machine (useReducer): `idle → submitting → success | business_error
 * | network_error`. The reducer is exported so tests can drive it without
 * mounting the React tree.
 *
 *   ┌──────┐  open   ┌────────────┐ ok   ┌──────────┐ 400ms ─▶ navigate
 *   │ idle ├────────▶│ submitting ├─────▶│  success │
 *   └──────┘         └─────┬──────┘      └──────────┘
 *                          │ business
 *                          ▼
 *                    ┌───────────────┐
 *                    │ business_error│ ◀── "Corregir y reenviar" → onClose
 *                    └───────────────┘
 *                          │ network
 *                          ▼
 *                    ┌──────────────┐ retry → submitting
 *                    │ network_error│
 *                    └──────────────┘
 *
 * Hard rules:
 *   - Cancel button DISABLED while `submitting`.
 *   - Esc DISABLED while `submitting`.
 *   - On `success` (AUTORIZADO / EN_PROCESO) we wait 400 ms then call
 *     `onSuccess(invoiceId)`. The parent navigates.
 *   - On `business_error` we list mensajes; show at most 5; "Ver más" expands.
 *   - On `network_error` we expose "Reintentar".
 */
import { useCallback, useEffect, useReducer, useRef, type ReactElement } from "react";

import type { EmitInvoiceResponse } from "@facturador/contracts/invoices";
import type { SriMensaje } from "@facturador/contracts/sri";

import { t } from "../../i18n/es.js";
import { ApiError } from "../../lib/api.js";

// ---------------------------------------------------------------------------
// Reducer state machine
// ---------------------------------------------------------------------------

export type EmitModalStatus =
  | "idle"
  | "submitting"
  | "success"
  | "business_error"
  | "network_error";

export interface EmitModalState {
  readonly status: EmitModalStatus;
  readonly response: EmitInvoiceResponse | null;
  readonly mensajes: readonly SriMensaje[];
  readonly errorTitle: string | null;
  /** Tracks whether the user clicked "Ver más" to expand mensajes. */
  readonly expanded: boolean;
}

export const EMIT_MODAL_INITIAL: EmitModalState = {
  status: "idle",
  response: null,
  mensajes: [],
  errorTitle: null,
  expanded: false,
};

export type EmitModalAction =
  | { type: "submit" }
  | { type: "success"; response: EmitInvoiceResponse }
  | { type: "business_error"; mensajes: readonly SriMensaje[]; title?: string }
  | { type: "network_error"; title?: string }
  | { type: "reset" }
  | { type: "expand" };

/**
 * The single reducer the modal uses. Exported so tests can pin every
 * transition without React.
 */
export function emitModalReducer(state: EmitModalState, action: EmitModalAction): EmitModalState {
  switch (action.type) {
    case "submit":
      return {
        status: "submitting",
        response: state.response,
        mensajes: [],
        errorTitle: null,
        expanded: false,
      };
    case "success":
      return {
        status: "success",
        response: action.response,
        mensajes: action.response.mensajes ?? [],
        errorTitle: null,
        expanded: false,
      };
    case "business_error":
      return {
        status: "business_error",
        response: state.response,
        mensajes: action.mensajes,
        errorTitle: action.title ?? null,
        expanded: false,
      };
    case "network_error":
      return {
        status: "network_error",
        response: state.response,
        mensajes: [],
        errorTitle: action.title ?? null,
        expanded: false,
      };
    case "expand":
      return { ...state, expanded: true };
    case "reset":
      return EMIT_MODAL_INITIAL;
  }
}

// ---------------------------------------------------------------------------
// Helpers used by the modal owner (InvoiceForm) and tests
// ---------------------------------------------------------------------------

/**
 * Translate an `ApiError` (or any thrown value) thrown by the emit call
 * into the next action the reducer should consume. Used by the modal
 * owner. Network outage (status 0, statusText etc.) becomes
 * `network_error`. Business 422/400/409 with mensajes becomes
 * `business_error`. Other 5xx → `network_error` (the operator can
 * retry).
 */
export function emitErrorToAction(err: unknown): EmitModalAction {
  if (err instanceof ApiError) {
    const status = err.status;
    if (status === 0) return { type: "network_error", title: err.problem.title };
    if (status >= 500) return { type: "network_error", title: err.problem.title };
    const mensajes = extractMensajes(err.problem);
    if (mensajes.length > 0) return { type: "business_error", mensajes, title: err.problem.title };
    // 4xx with no mensajes: treat as business_error with a synthetic
    // single-row mensaje so the user gets something actionable.
    return {
      type: "business_error",
      mensajes: [
        {
          identificador: err.problem.code,
          mensaje: err.problem.title,
          tipo: "ERROR",
        },
      ],
      title: err.problem.title,
    };
  }
  return { type: "network_error" };
}

function extractMensajes(problem: ApiError["problem"]): SriMensaje[] {
  const errs = problem.errors;
  if (errs === undefined || errs.length === 0) return [];
  return errs.map((row) => ({
    identificador: row.identificador,
    mensaje: row.mensaje,
    tipo: row.tipo,
    ...(row.informacionAdicional !== undefined
      ? { informacionAdicional: row.informacionAdicional }
      : {}),
  }));
}

/**
 * Translate an emit RESPONSE (200 OK with a body) into the next action.
 * AUTORIZADO / EN_PROCESO / RECIBIDA / ENVIADO → success.
 * DEVUELTA / NO_AUTORIZADO / ERROR_BUILD → business_error.
 * ERROR_RED → network_error.
 */
export function emitResponseToAction(response: EmitInvoiceResponse): EmitModalAction {
  const estado = response.estado;
  if (
    estado === "AUTORIZADO" ||
    estado === "EN_PROCESO" ||
    estado === "RECIBIDA" ||
    estado === "ENVIADO" ||
    estado === "FIRMADO"
  ) {
    return { type: "success", response };
  }
  if (estado === "ERROR_RED") {
    return { type: "network_error" };
  }
  // DEVUELTA / NO_AUTORIZADO / ERROR_BUILD / PENDIENTE.
  return { type: "business_error", mensajes: response.mensajes ?? [] };
}

const VISIBLE_LIMIT = 5;
const SUCCESS_REDIRECT_DELAY_MS = 400;

// ---------------------------------------------------------------------------
// Modal component
// ---------------------------------------------------------------------------

export interface EmitModalProps {
  readonly open: boolean;
  /** The current state — owned by the parent so the parent can drive transitions. */
  readonly state: EmitModalState;
  readonly dispatch: (action: EmitModalAction) => void;
  /** Called when the user dismisses the modal (close + "Corregir y reenviar"). */
  readonly onClose: () => void;
  /** Called on retry from `network_error`. */
  readonly onRetry: () => void;
  /** Called after the success state has been visible for 400 ms. */
  readonly onSuccessRedirect: () => void;
}

export function EmitModal({
  open,
  state,
  dispatch,
  onClose,
  onRetry,
  onSuccessRedirect,
}: EmitModalProps): ReactElement | null {
  const status = state.status;

  // Esc to close unless submitting.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === "Escape" && status !== "submitting") onClose();
    }
    window.addEventListener("keydown", onKey);
    return (): void => { window.removeEventListener("keydown", onKey); };
  }, [open, status, onClose]);

  // Auto-redirect 400 ms after success. Uses a ref so the timer is cleared
  // if the modal closes before firing.
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (status !== "success") {
      redirectedRef.current = false;
      return undefined;
    }
    if (redirectedRef.current) return undefined;
    redirectedRef.current = true;
    const handle = setTimeout(() => {
      onSuccessRedirect();
    }, SUCCESS_REDIRECT_DELAY_MS);
    return (): void => { clearTimeout(handle); };
  }, [status, onSuccessRedirect]);

  const handleExpand = useCallback(() => { dispatch({ type: "expand" }); }, [dispatch]);

  if (!open) return null;

  const visibleMensajes =
    state.expanded || state.mensajes.length <= VISIBLE_LIMIT
      ? state.mensajes
      : state.mensajes.slice(0, VISIBLE_LIMIT);
  const hiddenCount = state.mensajes.length - visibleMensajes.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="emit-modal-title"
      data-testid="emit-modal"
      data-status={status}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
    >
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <h2 id="emit-modal-title" className="text-lg font-semibold text-slate-900">
          {t("invoice.emit.modal.title")}
        </h2>

        {status === "submitting" && (
          <p
            role="status"
            aria-live="polite"
            data-testid="emit-modal-submitting"
            className="mt-3 text-sm text-slate-700"
          >
            {t("invoice.emit.modal.submitting")}
          </p>
        )}

        {status === "success" && (
          <p
            role="status"
            aria-live="polite"
            data-testid="emit-modal-success"
            className="mt-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
          >
            {state.response?.estado === "AUTORIZADO"
              ? t("invoice.emit.modal.success.authorized")
              : t("invoice.emit.modal.success.enProceso")}
          </p>
        )}

        {status === "business_error" && (
          <div data-testid="emit-modal-business-error" className="mt-3">
            <p role="alert" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {state.errorTitle ?? t("invoice.emit.modal.businessError.title")}
            </p>
            <ul className="mt-3 space-y-2">
              {visibleMensajes.map((m, i) => (
                <li
                  key={`${m.identificador}-${i.toString()}`}
                  data-testid="emit-mensaje"
                  className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                >
                  <span className="font-semibold">{m.identificador}</span>: {m.mensaje}
                </li>
              ))}
            </ul>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={handleExpand}
                className="mt-2 text-xs font-medium text-primary-700 underline"
              >
                {t("invoice.emit.modal.showMore")} ({hiddenCount.toString()})
              </button>
            )}
          </div>
        )}

        {status === "network_error" && (
          <div data-testid="emit-modal-network-error" className="mt-3">
            <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {state.errorTitle ?? t("invoice.emit.modal.networkError.title")}
            </p>
            <p className="mt-2 text-sm text-slate-700">
              {t("invoice.emit.modal.networkError.body")}
            </p>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {status === "business_error" && (
            <button
              type="button"
              onClick={onClose}
              data-testid="emit-modal-correct"
              className="rounded bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
            >
              {t("invoice.emit.modal.businessError.cta")}
            </button>
          )}
          {status === "network_error" && (
            <button
              type="button"
              onClick={onRetry}
              data-testid="emit-modal-retry"
              className="rounded bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
            >
              {t("invoice.emit.modal.networkError.retry")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={status === "submitting"}
            data-testid="emit-modal-cancel"
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("invoice.emit.modal.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Convenience hook for the modal owner. Encapsulates the reducer +
 * exposes a stable dispatch + state.
 */
export function useEmitModal(): {
  readonly state: EmitModalState;
  readonly dispatch: (action: EmitModalAction) => void;
} {
  const [state, dispatch] = useReducer(emitModalReducer, EMIT_MODAL_INITIAL);
  return { state, dispatch };
}
