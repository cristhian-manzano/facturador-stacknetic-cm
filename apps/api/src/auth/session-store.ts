/**
 * Session row lifecycle helpers.
 *
 * Source of truth:
 *   - SPEC-0010 §6.4 (createSession / refreshIfStale / revoke).
 *   - TASKS-0010 §4.1 (CRUD surface).
 *   - PLAN-0010 §3 (sliding window + hard cap).
 *
 * Lifecycle rules:
 *   - `createSession` is called by the login handler. It generates a fresh
 *     ULID for the session id, mints a fresh CSRF token, stores ONLY the
 *     SHA-256 of the token in `csrfTokenHash`, and sets `expiresAt` to
 *     `now + SESSION_TTL_MIN` (sliding window).
 *   - `loadSession` is called by the auth middleware. It returns the row
 *     if it exists and `expiresAt > now` AND `now - createdAt < HARD_CAP_MS`;
 *     otherwise it returns `null`. Expired rows are NOT auto-deleted here
 *     — a background sweep (future spec) handles that. We rely on the
 *     null-return to refuse access.
 *   - `touchSession` slides `expiresAt` forward by `SESSION_TTL_MIN`,
 *     capping at the absolute 30-day max measured from `createdAt`. We
 *     throttle the actual `UPDATE` to once per 5 minutes to avoid one
 *     row update per request — the lower bound stays correct because
 *     the upcoming hit still has an `expiresAt` in the future.
 *   - `deleteSession` is called by the logout handler. It performs a
 *     HARD delete (no soft delete on sessions per ai/context/security.md
 *     — a logged-out session must be unrecoverable).
 *
 * Inputs are deliberately narrow: `ip` and `userAgent` may be `undefined`
 * but never user-controlled tenant ids. `companyId` is reserved for
 * SPEC-0011 (tenant switching) and stays `null` here.
 */

import type { Prisma, PrismaClient } from "@facturador/db";
import { ulid } from "ulid";
import { env } from "../env.js";
import { hashCsrfToken, mintCsrfToken } from "./csrf.js";
import type { AuthenticatedSession } from "./types.js";

// 30 days = 30 * 24 * 60 minutes. Hard cap from `createdAt`. Beyond this,
// the user must log in again regardless of activity (PLAN-0010 §3).
const HARD_CAP_MS = 30 * 24 * 60 * 60 * 1000;

// Throttle the sliding-window UPDATE: only refresh `lastSeenAt`/`expiresAt`
// if the previous touch was > 5 minutes ago. Cheaper than a per-request
// write while still keeping the session alive on real activity.
const SLIDE_THROTTLE_MS = 5 * 60 * 1000;

const ttlMs = (): number => env.SESSION_TTL_MIN * 60 * 1000;

export interface CreateSessionInput {
  userId: string;
  /** Reserved for SPEC-0011 — pass `null` until tenant switching ships. */
  companyId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface CreateSessionResult {
  /** The session ULID; goes into the session cookie. */
  sessionId: string;
  /** The raw CSRF token; goes into the CSRF cookie (cookie is server-set). */
  csrfToken: string;
  /** Row expiry — useful for the response body if a client wants to display. */
  expiresAt: Date;
}

/**
 * Persist a new session row and return both the id and the freshly-minted
 * CSRF token. The token is HASHED before insert; the plaintext value lives
 * only in the cookie set on the same response.
 */
export async function createSession(
  prisma: PrismaClient,
  input: CreateSessionInput,
): Promise<CreateSessionResult> {
  const id = ulid();
  const csrfToken = mintCsrfToken();
  const csrfTokenHash = hashCsrfToken(csrfToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs());

  await prisma.session.create({
    data: {
      id,
      userId: input.userId,
      companyId: input.companyId ?? null,
      csrfTokenHash,
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  return { sessionId: id, csrfToken, expiresAt };
}

/**
 * Look up a session by id. Returns the typed row (narrowed via
 * `AuthenticatedSession`) if it exists AND has not expired AND is within
 * the absolute 30-day cap. Otherwise returns `null`.
 *
 * Why we re-check time-of-day inside `loadSession`:
 *   - `expiresAt < now`: handler rejects regardless of any DB optimisation.
 *   - `createdAt + HARD_CAP < now`: the row might still have a valid
 *     `expiresAt` if `touchSession` ran today, but the hard cap from
 *     issue is non-extendable per PLAN-0010 §3.
 */
export async function loadSession(
  prisma: PrismaClient,
  sessionId: string,
): Promise<AuthenticatedSession | null> {
  const row = await prisma.session.findUnique({ where: { id: sessionId } });
  if (row === null) return null;

  const now = Date.now();
  if (row.expiresAt.getTime() <= now) return null;
  if (now - row.createdAt.getTime() > HARD_CAP_MS) return null;

  return {
    id: row.id,
    userId: row.userId,
    companyId: row.companyId,
    csrfTokenHash: row.csrfTokenHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
  };
}

/**
 * Slide the session window forward. Throttled to one UPDATE per
 * `SLIDE_THROTTLE_MS` to avoid per-request writes.
 *
 * Returns the (possibly updated) session row, or `null` if the row
 * disappeared between the original load and this call (race-condition
 * safe — concurrent logout).
 */
export async function touchSession(
  prisma: PrismaClient,
  session: Pick<AuthenticatedSession, "id" | "createdAt" | "lastSeenAt">,
): Promise<void> {
  const now = Date.now();
  // Throttle: skip the write if the last touch was very recent.
  if (now - session.lastSeenAt.getTime() < SLIDE_THROTTLE_MS) return;

  // Cap the new expiry at `createdAt + HARD_CAP_MS` — never extend past
  // the absolute lifetime.
  const slideTarget = now + ttlMs();
  const absoluteMax = session.createdAt.getTime() + HARD_CAP_MS;
  const newExpiry = new Date(Math.min(slideTarget, absoluteMax));

  try {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(now), expiresAt: newExpiry },
    });
  } catch (err) {
    // Prisma throws P2025 ("Record to update not found") when the row was
    // concurrently deleted by a logout. Treat as a no-op — the next request
    // will receive a 401 from `loadSession`.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as Prisma.PrismaClientKnownRequestError).code === "P2025"
    ) {
      return;
    }
    throw err;
  }
}

/**
 * Hard-delete the session row. Idempotent: missing rows are not an error.
 */
export async function deleteSession(prisma: PrismaClient, sessionId: string): Promise<void> {
  try {
    await prisma.session.delete({ where: { id: sessionId } });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as Prisma.PrismaClientKnownRequestError).code === "P2025"
    ) {
      return;
    }
    throw err;
  }
}

/**
 * Tenant switch — atomic.
 *
 * Per SPEC-0011 §FR-3 + TASKS-0011 §3.3 hard rule "CSRF rotates on tenant
 * switch": we update `companyId` AND `csrfTokenHash` in the SAME row update
 * so a partial failure cannot leave the session in a state where the new
 * tenant is active but the old CSRF token still validates.
 *
 * Returns the freshly minted CSRF token (raw) so the handler can set it as
 * the new CSRF cookie. The hash is what we persisted.
 */
export interface SwitchTenantResult {
  csrfToken: string;
}

export async function switchSessionTenant(
  prisma: PrismaClient,
  sessionId: string,
  newCompanyId: string,
): Promise<SwitchTenantResult> {
  const csrfToken = mintCsrfToken();
  const csrfTokenHash = hashCsrfToken(csrfToken);

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      companyId: newCompanyId,
      csrfTokenHash,
      // Mark activity so the slide throttle window aligns with the switch.
      lastSeenAt: new Date(),
    },
  });

  return { csrfToken };
}
