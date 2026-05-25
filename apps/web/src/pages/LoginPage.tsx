/**
 * `LoginPage` — Spanish login form (SPEC-0041 §6.5 / TASKS-0041 §1.1).
 *
 * Behaviour:
 *   1. Renders an `email` + `password` form via React Hook Form with a
 *      `zodResolver(LoginRequestSchema)` (single source of truth from
 *      `@facturador/contracts/auth`).
 *   2. Submits via `apiFetch("/api/v1/auth/login", { method: "POST", json,
 *      schema: LoginResponseSchema })`. Never a raw `fetch` call.
 *   3. On 200: calls `auth.refresh()` so the AuthProvider reloads `/me`,
 *      then navigates to the sanitised `?next` (or `/`). The route guard
 *      sends users without a tenant to `/tenants/select` automatically.
 *   4. On 401: renders a banner with EXACTLY "Credenciales inválidas".
 *      Never branches on the server's actual cause (unknown email vs bad
 *      password) — anything that distinguishes the two leaks user state.
 *   5. On 429: renders a friendly throttle banner with retry hint.
 *   6. On 400 with ProblemDetail `errors[]`: inline field errors via the
 *      shared `mapProblemErrorsToForm` helper.
 *   7. Submit button + inputs disabled while pending; spinner inside the
 *      button keeps the focus order stable (so screen readers don't lose
 *      their cursor).
 *   8. Focuses the email field on mount via `useEffect(() => emailRef…)`.
 *      RHF's `setFocus` would also work, but we manage the ref explicitly
 *      so the autofocus behaviour stays testable.
 *
 * Accessibility:
 *   - Form fields have associated `<label>` elements (RTL `getByLabelText`).
 *   - The error banner uses `role="alert"` so assistive tech announces it.
 *   - Inputs link to their error messages via `aria-describedby`, plus
 *     `aria-invalid="true"` when applicable.
 *   - The submit button's busy state uses `aria-busy="true"`.
 *
 * Security (PROMPT-0041 §6 / ai/context/security.md):
 *   - Login error copy is ALWAYS the same Spanish phrase. Tests assert
 *     the absence of words like "email" / "usuario" / "no existe".
 *   - The `next` query parameter is sanitised via `sanitiseNext` BEFORE
 *     navigation. Any open-redirect-looking value falls back to `/`.
 *   - We never store the email / password anywhere. RHF holds them in
 *     React state for the duration of the page render and they're GC'd
 *     when the route unmounts.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  LoginRequestSchema,
  LoginResponseSchema,
  type LoginRequest,
} from "@facturador/contracts/auth";

import { useAuth } from "../auth/context.js";
import { mapProblemErrorsToForm } from "../auth/form-errors.js";
import { sanitiseNext } from "../auth/sanitise-next.js";
import { ApiError, apiFetch } from "../lib/api.js";
import { t } from "../i18n/es.js";

/**
 * Top-level banner kinds the login page can display. Each maps to a copy
 * key and tone — kept as a discriminated union so the JSX never has a stale
 * banner around.
 */
type BannerKind = "invalid" | "throttled" | "generic";

interface BannerState {
  kind: BannerKind;
  text: string;
}

function bannerForApiError(err: ApiError): BannerState {
  // 401 — wrong credentials. Always the same generic phrase. Do NOT branch
  // on `err.code` here; even "auth.unknown_email" must look identical to
  // "auth.bad_password" from the user's perspective.
  if (err.status === 401) {
    return { kind: "invalid", text: t("auth.login.invalidCredentials") };
  }
  if (err.status === 429) {
    return { kind: "throttled", text: t("auth.login.tooManyAttempts") };
  }
  return { kind: "generic", text: t("auth.login.generic") };
}

export function LoginPage(): ReactElement {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
  });

  const [banner, setBanner] = useState<BannerState | null>(null);

  // Focus management — first focus the email field on mount. React Hook
  // Form's `register` callback returns a ref that we forward so we don't
  // lose the field registration; the `emailRef` is the DOM element.
  const emailRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  // Compose RHF's `register` ref with our local ref. RHF accepts a callback
  // ref so we can route the DOM node to both targets without losing either.
  const emailReg = register("email");
  const passwordReg = register("password");

  const onSubmit = async (values: LoginRequest): Promise<void> => {
    setBanner(null);
    try {
      await apiFetch("/api/v1/auth/login", {
        method: "POST",
        json: values,
        schema: LoginResponseSchema,
      });
      // AuthProvider reloads `/me` and exposes the membership list.
      await auth.refresh();
      const nextTarget = sanitiseNext(searchParams.get("next"));
      navigate(nextTarget, { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError) {
        // Inline field errors from the server (only for 400 ProblemDetail).
        if (cause.status === 400 && cause.problem.errors !== undefined) {
          mapProblemErrorsToForm(setError, cause.problem.errors, {
            fieldMap: { email: "email", password: "password" },
          });
          // Avoid double-display: if every error mapped to a known field,
          // don't also show a banner. Otherwise show generic banner.
          const allMapped = cause.problem.errors.every((e) =>
            ["email", "password"].includes(e.identificador),
          );
          if (!allMapped) {
            setBanner({ kind: "generic", text: t("auth.login.generic") });
          }
          return;
        }
        setBanner(bannerForApiError(cause));
        return;
      }
      // Unknown error — show the generic banner. Never surface the
      // underlying error message; it may carry server internals.
      setBanner({ kind: "generic", text: t("auth.login.generic") });
    }
  };

  const isBusy = isSubmitting;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4">
      <section
        aria-labelledby="login-title"
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <header className="mb-6 space-y-1">
          <h1 id="login-title" className="text-2xl font-semibold text-slate-900">
            {t("auth.login.title")}
          </h1>
          <p className="text-sm text-slate-600">{t("auth.login.lead")}</p>
        </header>

        {banner !== null && (
          <div
            role="alert"
            data-testid="login-banner"
            data-banner-kind={banner.kind}
            className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {banner.text}
          </div>
        )}

        <form
          noValidate
          onSubmit={(event) => {
            void handleSubmit(onSubmit)(event);
          }}
          aria-describedby={banner !== null ? "login-banner" : undefined}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">
              {t("auth.login.email")}
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              required
              disabled={isBusy}
              aria-invalid={errors.email !== undefined}
              aria-describedby={errors.email !== undefined ? "login-email-error" : undefined}
              {...emailReg}
              ref={(node) => {
                emailReg.ref(node);
                emailRef.current = node;
              }}
              className="block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-slate-100"
            />
            {errors.email !== undefined && (
              <p id="login-email-error" role="alert" className="text-xs text-red-700">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">
              {t("auth.login.password")}
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              disabled={isBusy}
              aria-invalid={errors.password !== undefined}
              aria-describedby={errors.password !== undefined ? "login-password-error" : undefined}
              {...passwordReg}
              className="block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-slate-100"
            />
            {errors.password !== undefined && (
              <p id="login-password-error" role="alert" className="text-xs text-red-700">
                {errors.password.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isBusy}
            aria-busy={isBusy}
            data-testid="login-submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:bg-primary-400"
          >
            {isBusy && (
              <span
                aria-hidden="true"
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
              />
            )}
            <span>{isBusy ? t("auth.login.submitting") : t("auth.login.submit")}</span>
          </button>
        </form>
      </section>
    </main>
  );
}
