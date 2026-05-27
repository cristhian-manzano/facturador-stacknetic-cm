/**
 * `<OfflineBanner />` — visual indicator when the browser reports offline.
 *
 * Listens to `online` / `offline` events on `window` and renders a sticky
 * banner across the top of the viewport while `navigator.onLine` is
 * false. Once we're back online the banner disappears.
 *
 * The banner is non-blocking — the user can still navigate. We surface it
 * so they know a 401/refresh failure was network-related, not a session
 * problem.
 *
 * Accessibility:
 *   - `role="status"` so AT announces the change.
 *   - When offline, the banner is `aria-live="polite"` and announces "Sin
 *     conexión".
 */
import { useEffect, useState, type ReactElement } from "react";

function readOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function OfflineBanner(): ReactElement | null {
  const [online, setOnline] = useState<boolean>(readOnline);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onOnline = (): void => {
      setOnline(true);
    };
    const onOffline = (): void => {
      setOnline(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="sticky top-0 z-40 w-full bg-amber-100 px-3 py-1 text-center text-xs font-medium text-amber-900"
    >
      Sin conexión
    </div>
  );
}
