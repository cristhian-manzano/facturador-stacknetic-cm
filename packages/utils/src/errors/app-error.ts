/**
 * `AppError` — base class for every typed error in the platform.
 *
 * Defined per SPEC-0006 §6.5 + TASKS-0006 §1.1.
 *
 * Properties:
 *   - `status`   — HTTP status code (100..599) the error handler must use.
 *   - `code`     — snake-case, namespaced (e.g. `auth.invalid_credentials`).
 *                  Matches `ProblemDetailSchema.code` regex from contracts.
 *   - `detail`   — optional user-facing free text. MUST NOT include stack
 *                  traces or third-party API URLs (see SPEC-0006 §10).
 *   - `errors`   — optional `SriMensaje[]` for validation/SRI multi-issue
 *                  responses. Sanitised at construction time by the caller.
 *
 * Subclasses live in sibling files and supply default `status` + `code`.
 *
 * The class is `abstract`-by-convention rather than `abstract`-by-syntax
 * because instantiating it directly is sometimes useful for tests; subclasses
 * are the supported callers.
 */
import type { SriMensaje } from "@facturador/contracts/errors";

export interface AppErrorOptions {
  /** Optional human-readable detail. NEVER include secrets or stack traces. */
  readonly detail?: string;
  /** Optional list of validation / SRI messages. */
  readonly errors?: readonly SriMensaje[];
  /** Native cause forwarded to `Error.cause` for server-side debugging. */
  readonly cause?: unknown;
}

export class AppError extends Error {
  public override readonly name: string;
  public readonly status: number;
  public readonly code: string;
  public readonly detail?: string;
  public readonly errors?: readonly SriMensaje[];

  constructor(message: string, status: number, code: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    if (options.detail !== undefined) this.detail = options.detail;
    if (options.errors !== undefined) this.errors = options.errors;
  }
}
