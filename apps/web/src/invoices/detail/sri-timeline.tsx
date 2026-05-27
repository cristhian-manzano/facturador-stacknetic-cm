/**
 * `<SriTimeline />` — ordered list of SRI lifecycle events
 * (SPEC-0043 §FR-2 + TASKS-0043 §2.3).
 *
 * Hard rules:
 *   - Rendered as a semantic `<ol aria-label="Eventos SRI">`.
 *   - Events sorted by `createdAt` ascending (oldest first). Sorting
 *     happens HERE so the parent doesn't need to remember the
 *     contract.
 *   - Each entry shows `etapa`, `estado`, `mensajes` (if any),
 *     `durationMs`. Error mensajes (`tipo === "ERROR"`) tinted red.
 *   - Empty list → "Sin eventos registrados" placeholder.
 *
 * Pure: takes the events array; no fetches.
 */
import type { ReactElement } from "react";

import type { SriEvent } from "@facturador/contracts/sri";

import { t } from "../../i18n/es.js";

/**
 * Stable etapa labels in Spanish.
 *
 * Note: TASKS-0043 §2.3 leaves the labels free-form; we keep them
 * short so the timeline reads top-to-bottom without wrapping.
 */
function etapaLabel(etapa: SriEvent["etapa"]): string {
  switch (etapa) {
    case "BUILD":
      return "Construcción XML";
    case "SIGN":
      return "Firma XAdES";
    case "SEND":
      return "Envío a SRI";
    case "RECEIVE":
      return "Recepción SRI";
    case "AUTHORIZE":
      return "Autorización SRI";
    case "POLL":
      return "Consulta de estado";
    case "ERROR":
      return "Error";
  }
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mi = d.getUTCMinutes().toString().padStart(2, "0");
  const ss = d.getUTCSeconds().toString().padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
}

/**
 * Sort events ascending by `createdAt`. Pure: exported for tests.
 */
export function sortEventsAsc(events: readonly SriEvent[]): readonly SriEvent[] {
  return events.slice().sort((a, b) => {
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    return 0;
  });
}

export interface SriTimelineProps {
  readonly events: readonly SriEvent[];
}

export function SriTimeline({ events }: SriTimelineProps): ReactElement {
  const ordered = sortEventsAsc(events);
  return (
    <section
      data-testid="sri-timeline-section"
      className="space-y-2 rounded border border-slate-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-slate-900">{t("invoice.detail.timeline.title")}</h2>
      {ordered.length === 0 ? (
        <p data-testid="sri-timeline-empty" className="text-sm text-slate-500">
          {t("invoice.detail.timeline.empty")}
        </p>
      ) : (
        <ol
          aria-label={t("invoice.detail.timeline.title")}
          data-testid="sri-timeline"
          className="space-y-2"
        >
          {ordered.map((ev) => {
            const hasError = ev.mensajes.some((m) => m.tipo === "ERROR");
            return (
              <li
                key={ev.id}
                data-testid={`sri-event-${ev.id}`}
                className="rounded border border-slate-200 p-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span
                      data-testid={`sri-event-etapa-${ev.id}`}
                      className="text-sm font-medium text-slate-900"
                    >
                      {etapaLabel(ev.etapa)}
                    </span>
                    <span
                      data-testid={`sri-event-estado-${ev.id}`}
                      className="text-xs text-slate-600"
                    >
                      {ev.estado}
                    </span>
                  </div>
                  <span
                    data-testid={`sri-event-duration-${ev.id}`}
                    className="text-xs text-slate-500"
                  >
                    {t("invoice.detail.timeline.duration", { ms: ev.durationMs })}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{formatCreatedAt(ev.createdAt)}</div>
                {ev.mensajes.length > 0 && (
                  <ul data-testid={`sri-event-mensajes-${ev.id}`} className="mt-1 space-y-0.5">
                    {ev.mensajes.map((m, idx) => (
                      <li
                        key={`${m.identificador}-${String(idx)}`}
                        data-testid={`sri-mensaje-${ev.id}-${String(idx)}`}
                        className={
                          m.tipo === "ERROR" ? "text-xs text-rose-700" : "text-xs text-slate-700"
                        }
                      >
                        <span className="font-mono">{m.identificador}</span>
                        {": "}
                        {m.mensaje}
                      </li>
                    ))}
                  </ul>
                )}
                {hasError && (
                  <span data-testid={`sri-event-has-error-${ev.id}`} className="sr-only">
                    error
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
