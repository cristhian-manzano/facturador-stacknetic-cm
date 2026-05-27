/**
 * `ForbiddenPage` — 403 destination for `RequirePermission` and `auth:403`.
 *
 * Static page; no fetches. The "back" CTA uses absolute navigation to
 * `/` because Router history may have stacked the forbidden route only.
 */
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { t } from "../i18n/es.js";

export function ForbiddenPage(): ReactElement {
  return (
    <main className="container mx-auto max-w-lg py-16 text-center">
      <h1 className="text-3xl font-semibold text-slate-900">{t("forbidden.title")}</h1>
      <p className="mt-4 text-slate-600">{t("forbidden.body")}</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
      >
        {t("forbidden.back")}
      </Link>
    </main>
  );
}
