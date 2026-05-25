/**
 * `NotFoundPage` — fallback for unknown routes.
 *
 * Lives outside the AppLayout because we want to render even when no
 * tenant context is available (e.g. typo'd URL while logged out).
 */
import { Link } from "react-router-dom";
import type { ReactElement } from "react";

import { t } from "../i18n/es.js";

export function NotFoundPage(): ReactElement {
  return (
    <main className="container mx-auto max-w-lg py-16 text-center">
      <h1 className="text-3xl font-semibold text-slate-900">{t("notFound.title")}</h1>
      <p className="mt-4 text-slate-600">{t("notFound.body")}</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
      >
        {t("forbidden.back")}
      </Link>
    </main>
  );
}
