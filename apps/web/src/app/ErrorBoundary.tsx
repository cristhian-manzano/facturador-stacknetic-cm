/**
 * `ErrorBoundary` — top-level render-error catch (REVIEW-0044 §UX).
 *
 * React error boundaries can ONLY be class components — there's no hook
 * equivalent in React 18. We keep this class tiny and lean on the rest of
 * the app (functional) for everything else.
 *
 * Behaviour:
 *   - Catches errors thrown DURING RENDER of any descendant component.
 *     Errors thrown in event handlers / async code are NOT caught; they
 *     bubble up to `window.onerror` / unhandled-rejection.
 *   - Renders a friendly Spanish fallback with a "Recargar" button.
 *   - Logs the error via the web `logger.error` so we have one place to
 *     wire Sentry later.
 *   - The "Reload" button is a real `<button>` so keyboard users can
 *     focus + activate it (Enter / Space).
 */
import { Component, type ErrorInfo, type ReactElement, type ReactNode } from "react";

import { t } from "../i18n/es.js";
import { logger } from "../lib/logger.js";

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * Test seam — when provided we use it instead of `window.location.reload`
   * so the unit test can assert without actually reloading jsdom.
   */
  readonly onReload?: () => void;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly errorMessage: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { hasError: false, errorMessage: null };

  public static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: message };
  }

  public override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // `info.componentStack` is the React render tree at the time of error
    // — useful in a Sentry breadcrumb when that gets wired.
    logger.error("[ErrorBoundary] render error caught", error, info.componentStack);
  }

  private handleReload = (): void => {
    if (this.props.onReload !== undefined) {
      this.props.onReload();
      return;
    }
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main
          role="alert"
          data-testid="error-boundary-fallback"
          className="container mx-auto max-w-lg py-16 text-center"
        >
          <h1 className="text-2xl font-semibold text-slate-900">{t("error.boundary.title")}</h1>
          <p className="mt-4 text-sm text-slate-600">{t("error.boundary.body")}</p>
          <button
            type="button"
            data-testid="error-boundary-reload"
            onClick={this.handleReload}
            className="mt-6 inline-flex items-center justify-center rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            Recargar
          </button>
        </main>
      );
    }
    return this.props.children as ReactElement;
  }
}
