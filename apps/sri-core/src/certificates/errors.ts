/**
 * Domain errors for certificate parse / activate / load flows.
 *
 * All extend `BusinessError` (422) or `ConflictError` (409). The shared
 * `toProblemDetail` mapper turns them into a ProblemDetail with the exact
 * `code` SPEC-0021 requires. We deliberately do NOT embed any cert bytes
 * or passphrase characters in any message; the message stays generic, and
 * the route handler logs the structured `{ event, companyId }` separately
 * (with redaction).
 */
import { BusinessError, ConflictError } from "@facturador/utils/errors";

/**
 * Wrong passphrase for an uploaded .p12. Mapped to HTTP 422 with
 * `code: "bad_passphrase"` per TASKS-0021 §9.1.
 */
export class BadPassphraseError extends BusinessError {
  constructor() {
    super("Bad passphrase for certificate", "bad_passphrase");
  }
}

/**
 * The .p12 bytes did not parse as PKCS#12 (corrupt, wrong format,
 * truncated, wrong file type). Mapped to HTTP 422 with
 * `code: "parse_failed"`.
 */
export class ParseError extends BusinessError {
  constructor(reason: string) {
    super(`Could not parse certificate file: ${reason}`, "parse_failed");
  }
}

/**
 * Upload of an already-expired certificate. Mapped to HTTP 422 with
 * `code: "cert_expired"` per TASKS-0021 §9.3.
 */
export class ExpiredCertificateError extends BusinessError {
  constructor() {
    super("Certificate already expired (validTo in the past)", "cert_expired");
  }
}

/**
 * Refusing to delete an ACTIVE certificate. Mapped to HTTP 409 with
 * `code: "cannot_delete_active"` per TASKS-0021 §5.2.
 */
export class CannotDeleteActiveError extends ConflictError {
  constructor() {
    super(
      "Cannot delete the active certificate — activate another one first",
      "cannot_delete_active",
    );
  }
}

/**
 * Duplicate fingerprint upload. Mapped to HTTP 409 with `code: "conflict"`
 * per TASKS-0021 §9.2.
 */
export class DuplicateFingerprintError extends ConflictError {
  constructor() {
    super("Certificate with this fingerprint already uploaded", "conflict");
  }
}
