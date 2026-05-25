/**
 * `useToast` — minimal toast state, scoped to the detail page.
 *
 * Used by the action bar to surface "Próximamente" / "Acción
 * completada" / "No pudimos completar la acción" hints. Intentionally
 * NOT a global toast system (later spec); a 1-message-at-a-time
 * useState is enough.
 *
 * The hint auto-dismisses after `durationMs` (default 2500 ms). The
 * caller can also dismiss manually.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type ToastVariant = "info" | "success" | "error";

export interface ToastState {
  readonly message: string;
  readonly variant: ToastVariant;
}

export interface UseToastReturn {
  readonly toast: ToastState | null;
  show: (message: string, variant?: ToastVariant, durationMs?: number) => void;
  dismiss: () => void;
}

export function useToast(): UseToastReturn {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setToast(null);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback((message: string, variant: ToastVariant = "info", durationMs = 2500) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setToast({ message, variant });
    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, durationMs);
  }, []);

  // Clear timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return { toast, show, dismiss };
}
