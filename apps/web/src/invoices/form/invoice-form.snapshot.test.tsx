/**
 * `<InvoiceForm />` SSR markup snapshot (REVIEW-0044 §10).
 *
 * Catches label↔input pairing regressions: if a refactor breaks the
 * `<label htmlFor>` ↔ input `id` association, the snapshot will surface
 * a missing `htmlFor` or `id` attribute. We deliberately render via
 * `renderToString` (React DOM Server) so the snapshot has no test-only
 * DOM munging.
 *
 * The test does NOT assert client-side behaviour — every interactive
 * test lives in `invoice-form.test.tsx`. This file only protects the
 * static accessibility contract.
 */
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { InvoiceForm } from "./invoice-form.js";

const STUB_EMISSION_POINTS = [
  {
    id: "ep-1",
    label: "001-001 Punto principal",
    establecimientoCodigo: "001",
    puntoEmisionCodigo: "001",
    isDefault: true,
  },
];

describe("<InvoiceForm /> SSR snapshot", () => {
  it("matches the canonical static markup", () => {
    const html = renderToString(
      <MemoryRouter>
        <InvoiceForm emissionPointsOverride={STUB_EMISSION_POINTS} />
      </MemoryRouter>,
    );
    // We strip the dynamic `id` / `for` values that `useId` emits — they
    // depend on the React internal counter and aren't stable across
    // builds. The snapshot still proves every label that DID have an id
    // pair retains one (the placeholder marker survives).
    const stable = html
      .replace(/id="[^"]*"/g, 'id="__ID__"')
      .replace(/for="[^"]*"/g, 'for="__ID__"')
      .replace(/aria-controls="[^"]*"/g, 'aria-controls="__ID__"')
      .replace(/aria-activedescendant="[^"]*"/g, 'aria-activedescendant="__ID__"');
    expect(stable).toMatchSnapshot();
  });

  it("every visible label is paired with a control via htmlFor/id", () => {
    const html = renderToString(
      <MemoryRouter>
        <InvoiceForm emissionPointsOverride={STUB_EMISSION_POINTS} />
      </MemoryRouter>,
    );
    // Extract every `for="..."` attribute, then assert the corresponding
    // `id="..."` exists on a control somewhere in the HTML. This is a
    // weak structural check but it would catch the regression of a stray
    // label that lost its target.
    const labelFors = [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map((m) => m[1]);
    for (const target of labelFors) {
      if (target === undefined || target === "") continue;
      expect(html).toContain(`id="${target}"`);
    }
  });
});
