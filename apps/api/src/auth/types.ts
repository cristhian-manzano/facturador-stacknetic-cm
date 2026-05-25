/**
 * Typed request-attachment shapes for the auth middleware.
 *
 * Kept in their own module so the Express `Request` augmentation
 * (src/types/express.d.ts) can `import type` them without pulling in
 * runtime modules. The actual data is populated by `requireSession`
 * (see require-session.ts) from the database.
 *
 * The shapes are NARROW: each field is something a downstream handler
 * legitimately needs (e.g. `companyId` for tenant scoping, `csrfTokenHash`
 * for `assertCsrf`). We deliberately avoid leaking the whole Prisma row
 * to keep the surface small and the redaction story trivial.
 */

export interface AuthenticatedSession {
  /** ULID identifying the session row. */
  readonly id: string;
  /** Owner user id (also available on `req.user.id`). */
  readonly userId: string;
  /** Active company; nullable until SPEC-0011 wires tenant switching. */
  readonly companyId: string | null;
  /** SHA-256 hex of the issued CSRF token; compared by `assertCsrf`. */
  readonly csrfTokenHash: string;
  /** ISO timestamp marking row insertion. */
  readonly createdAt: Date;
  /** Sliding window expiry; refreshed by `touchSession`. */
  readonly expiresAt: Date;
  /** Last touch time; used to throttle the sliding-window update. */
  readonly lastSeenAt: Date;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly isSuperadmin: boolean;
}
