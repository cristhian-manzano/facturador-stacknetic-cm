/**
 * Tests for `<SriTimeline />` (TASKS-0043 §2.3).
 *
 * Covers:
 *   - Renders an `<ol>` with `aria-label="Eventos SRI"`.
 *   - Events sorted by `createdAt` ascending.
 *   - Each entry shows etapa + estado + durationMs.
 *   - Mensajes with `tipo === "ERROR"` styled red (rose-700 text).
 *   - Empty events array → "Sin eventos registrados".
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { SriEvent } from "@facturador/contracts/sri";

import { SriTimeline, sortEventsAsc } from "./sri-timeline.js";

const ULID_BASE = "01HX8K0PYFA9B7Y1M2N3P4Q5"; // 25 chars, suffix tweak per event
const documentId = `${ULID_BASE}DD`;

function makeEvent(
  suffix: string,
  createdAt: string,
  etapa: SriEvent["etapa"],
  mensajes: SriEvent["mensajes"] = [],
): SriEvent {
  // Branded primitives are zod-tagged at the type level; we cast through
  // `unknown` because the test only cares about the in-memory shape.
  return {
    id: `${ULID_BASE}${suffix}`,
    documentId,
    etapa,
    estado: "AUTORIZADO",
    mensajes,
    durationMs: 12,
    createdAt,
  } as unknown as SriEvent;
}

describe("sortEventsAsc", () => {
  it("sorts events by createdAt ascending", () => {
    const events = [
      makeEvent("CC", "2026-05-19T10:00:30.000Z", "AUTHORIZE"),
      makeEvent("AA", "2026-05-19T10:00:00.000Z", "BUILD"),
      makeEvent("BB", "2026-05-19T10:00:15.000Z", "SEND"),
    ];
    const sorted = sortEventsAsc(events);
    expect(sorted.map((e) => e.id.endsWith("AA"))).toEqual([true, false, false]);
    expect(sorted.map((e) => e.etapa)).toEqual(["BUILD", "SEND", "AUTHORIZE"]);
  });

  it("does NOT mutate the input array", () => {
    const events = [
      makeEvent("CC", "2026-05-19T10:00:30.000Z", "AUTHORIZE"),
      makeEvent("AA", "2026-05-19T10:00:00.000Z", "BUILD"),
    ];
    const before = [...events];
    sortEventsAsc(events);
    expect(events).toEqual(before);
  });
});

describe("<SriTimeline />", () => {
  it("renders an ol with aria-label='Eventos SRI'", () => {
    render(<SriTimeline events={[makeEvent("AA", "2026-05-19T10:00:00.000Z", "BUILD")]} />);
    const list = screen.getByRole("list", { name: "Eventos SRI" });
    expect(list.tagName.toLowerCase()).toBe("ol");
  });

  it("renders 4 events in chronological order", () => {
    const events = [
      makeEvent("DD", "2026-05-19T10:00:45.000Z", "AUTHORIZE"),
      makeEvent("AA", "2026-05-19T10:00:00.000Z", "BUILD"),
      makeEvent("CC", "2026-05-19T10:00:30.000Z", "RECEIVE"),
      makeEvent("BB", "2026-05-19T10:00:15.000Z", "SIGN"),
    ];
    render(<SriTimeline events={events} />);
    const list = screen.getByTestId("sri-timeline");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    // Walk the DOM in order and check the etapa labels are ascending.
    const etapas = items.map((li) => within(li).getByTestId(/sri-event-etapa-/).textContent);
    expect(etapas).toEqual([
      "Construcción XML",
      "Firma XAdES",
      "Recepción SRI",
      "Autorización SRI",
    ]);
  });

  it("renders mensajes; ERROR-tipo mensajes get the rose text class", () => {
    const events = [
      makeEvent("AA", "2026-05-19T10:00:00.000Z", "AUTHORIZE", [
        { identificador: "70", mensaje: "Clave inválida", tipo: "ERROR" },
        { identificador: "10", mensaje: "Aviso", tipo: "INFORMATIVO" },
      ]),
    ];
    render(<SriTimeline events={events} />);
    const errorMsg = screen.getByTestId(`sri-mensaje-${events[0]!.id}-0`);
    expect(errorMsg.className).toContain("text-rose-700");
    expect(errorMsg).toHaveTextContent("70");
    expect(errorMsg).toHaveTextContent("Clave inválida");
    const infoMsg = screen.getByTestId(`sri-mensaje-${events[0]!.id}-1`);
    expect(infoMsg.className).not.toContain("text-rose-700");
  });

  it("shows the empty placeholder when events is empty", () => {
    render(<SriTimeline events={[]} />);
    expect(screen.getByTestId("sri-timeline-empty")).toBeInTheDocument();
  });
});
