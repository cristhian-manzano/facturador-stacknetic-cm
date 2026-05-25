/**
 * `HomePage` — placeholder landing inside the authenticated shell.
 *
 * Real dashboard content lands with SPEC-0042 / SPEC-0043. For PROMPT-0040
 * we render a friendly welcome so the smoke test has something to assert.
 */
import type { ReactElement } from "react";

import { t } from "../i18n/es.js";

export function HomePage(): ReactElement {
  return (
    <section aria-labelledby="home-title">
      <h1 id="home-title" className="text-2xl font-semibold text-slate-900">
        {t("home.title")}
      </h1>
      <p className="mt-2 text-slate-600">{t("home.lead")}</p>
    </section>
  );
}
