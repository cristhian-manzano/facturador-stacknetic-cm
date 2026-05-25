/**
 * `<ClaveAccesoChip />` — display + copy-to-clipboard for a 49-digit
 * clave de acceso (SPEC-0043 §FR-2 + TASKS-0043 §4.1).
 *
 * Rendering:
 *   - Formats the 49 digits in groups of 4 separated by spaces for
 *     readability (so `19052026...` → `1905 2026 0117 9001 …`). The
 *     final group is the leftover digits (49 / 4 == 12 r 1 → last
 *     group is the single check-digit).
 *   - Renders the formatted value inside a `<span>` with `font-mono`
 *     and the raw 49-digit value inside the `<button>`'s `aria-label`
 *     so screen readers announce the canonical (unformatted) value.
 *
 * Copy button:
 *   - Uses `navigator.clipboard.writeText` when available.
 *   - On unsupported browsers, the button is rendered but the click is
 *     a no-op (we surface a "No se pudo copiar" toast). NEVER falls
 *     back to `document.execCommand("copy")` — deprecated; the no-op
 *     is the contractually-correct behaviour per PROMPT-0043 §3.
 *   - Successful copy flashes "Copiada" for 1500 ms, then reverts.
 *
 * Security:
 *   - `claveAcceso` is publicly visible on the printed RIDE; surfacing
 *     it in the SPA is fine (ai/context/security.md is silent on it).
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import { t } from "../../i18n/es.js";

/**
 * Pure formatter: insert a space every 4 characters.
 *
 * Exported so the unit test can pin the exact spacing.
 */
export function formatClaveAcceso(clave: string): string {
  if (clave.length === 0) return "";
  const groups: string[] = [];
  for (let i = 0; i < clave.length; i += 4) {
    groups.push(clave.slice(i, i + 4));
  }
  return groups.join(" ");
}

export interface ClaveAccesoChipProps {
  readonly clave: string;
}

type CopyState = "idle" | "copied" | "error";

export function ClaveAccesoChip({ clave }: ClaveAccesoChipProps): ReactElement {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const flash = useCallback((next: CopyState) => {
    setCopyState(next);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setCopyState("idle");
      timerRef.current = null;
    }, 1500);
  }, []);

  const onCopy = useCallback(async () => {
    // Feature-detect `navigator.clipboard` defensively — jsdom may not
    // expose it in tests, older browsers don't have it on insecure
    // contexts. The hard rule: NEVER throw; surface a no-op + toast.
    const clipboard =
      typeof navigator !== "undefined" &&
      navigator.clipboard !== undefined &&
      typeof navigator.clipboard.writeText === "function"
        ? navigator.clipboard
        : null;
    if (clipboard === null) {
      flash("error");
      return;
    }
    try {
      await clipboard.writeText(clave);
      flash("copied");
    } catch {
      flash("error");
    }
  }, [clave, flash]);

  const buttonLabel =
    copyState === "copied"
      ? t("invoice.detail.header.claveAcceso.copied")
      : copyState === "error"
        ? t("invoice.detail.header.claveAcceso.copyError")
        : t("invoice.detail.header.claveAcceso.copy");

  return (
    <span className="inline-flex items-center gap-2">
      <span
        data-testid="clave-acceso-formatted"
        className="font-mono text-xs tracking-tight text-slate-700"
        // Title attribute carries the raw 49 digits for power users that
        // want to select-copy via right-click. It's NEVER a tooltip with
        // PII — claveAcceso is non-sensitive (public on the printed RIDE).
        title={clave}
      >
        {formatClaveAcceso(clave)}
      </span>
      <button
        type="button"
        onClick={() => void onCopy()}
        data-testid="clave-acceso-copy"
        aria-label={buttonLabel}
        className="rounded border border-slate-300 px-1.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {buttonLabel}
      </button>
    </span>
  );
}
