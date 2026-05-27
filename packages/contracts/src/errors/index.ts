/**
 * Subpath: `@facturador/contracts/errors`.
 *
 * `SriMensaje` is re-exported because consumers building a `ProblemDetail`
 * almost always need to construct the inner `errors[]` items and it's
 * convenient not to require a second import.
 */
export { ProblemDetailSchema, type ProblemDetail } from "./problem-detail.js";
export { SriMensajeSchema, type SriMensaje } from "../sri/mensaje.js";
export { ErrorCodes, type ErrorCode } from "./codes.js";
