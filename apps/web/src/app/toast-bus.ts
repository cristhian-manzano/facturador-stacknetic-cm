/**
 * Global toast event bus.
 *
 * Other parts of the app (auto-save error, multi-tab signout, etc.) call
 * `emitToast({ message, variant })` and the `<ToastContainer />` mounted
 * once in `App.tsx` picks the message up and renders it with a fade-out.
 *
 * Why an event bus instead of a context?
 *   - Toasts are fire-and-forget — emitters don't render the toast UI.
 *   - Many call sites (hooks, non-react code) need to emit; an event bus
 *     keeps them framework-agnostic.
 *   - Single subscriber (the container) so the bus is a tiny EventTarget.
 *
 * Contract:
 *   - `emitToast(detail)` dispatches a `"toast"` CustomEvent on the window.
 *   - Subscribers add a `"toast"` listener and read `event.detail`.
 *   - The default duration is 2500 ms; callers can override via
 *     `durationMs`.
 */

export type ToastVariant = "info" | "success" | "error";

export interface ToastDetail {
  readonly message: string;
  readonly variant?: ToastVariant;
  readonly durationMs?: number;
}

export const TOAST_EVENT = "toast";

export function emitToast(detail: ToastDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail }));
}

export function onToast(listener: (detail: ToastDetail) => void): () => void {
  if (typeof window === "undefined") {
    return () => {
      /* noop */
    };
  }
  const handler = (event: Event): void => {
    const ce = event as CustomEvent<ToastDetail>;
    listener(ce.detail);
  };
  window.addEventListener(TOAST_EVENT, handler);
  return () => {
    window.removeEventListener(TOAST_EVENT, handler);
  };
}
