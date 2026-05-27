/**
 * `<ToastContainer />` — global toast renderer (REVIEW-0044 §UX).
 *
 * Mounted ONCE at the top of `<App />`, listens to the toast event bus
 * (`onToast`) and renders one toast at a time. After `durationMs` (default
 * 2500 ms) the toast auto-dismisses.
 *
 * Why one at a time?
 *   - v1 only needs simple confirmations / warnings ("Borrador guardado",
 *     "Sin conexión", "Sesión cerrada en otra pestaña"). A queue is
 *     overkill for that volume.
 *   - When a newer toast arrives, the previous one is replaced (the timer
 *     resets). This is the user-friendly choice: never show stale info.
 *
 * Accessibility:
 *   - `role="status"` so assistive tech announces the message politely.
 *   - The container ALWAYS renders (just empty when no toast) so screen
 *     readers don't lose the live region.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";

import { onToast, type ToastDetail } from "./toast-bus.js";

interface ActiveToast {
  readonly id: number;
  readonly detail: ToastDetail;
}

export const DEFAULT_TOAST_DURATION_MS = 2500;

export function ToastContainer(): ReactElement {
  const [active, setActive] = useState<ActiveToast | null>(null);
  const counterRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return onToast((detail) => {
      counterRef.current += 1;
      const id = counterRef.current;
      setActive({ id, detail });
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      const duration = detail.durationMs ?? DEFAULT_TOAST_DURATION_MS;
      timerRef.current = setTimeout(() => {
        setActive((prev) => (prev !== null && prev.id === id ? null : prev));
        timerRef.current = null;
      }, duration);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const variant = active?.detail.variant ?? "info";
  const colors =
    variant === "error"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : variant === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-slate-200 bg-white text-slate-900";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="toast-container"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col items-end gap-2"
    >
      {active !== null && (
        <div
          data-testid={`toast-${variant}`}
          className={`pointer-events-auto rounded border px-3 py-2 text-sm shadow ${colors}`}
        >
          {active.detail.message}
        </div>
      )}
    </div>
  );
}
