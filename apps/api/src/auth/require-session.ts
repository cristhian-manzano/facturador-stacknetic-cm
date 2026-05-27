/**
 * `requireSession` middleware.
 *
 * Source of truth:
 *   - SPEC-0010 §6.5.
 *   - TASKS-0010 §6.1.
 *
 * Responsibilities:
 *   1. Read the opaque session ULID from the project-named cookie (see
 *      `cookies.ts`). Missing cookie → `AuthError("auth.unauthenticated")`.
 *   2. Look up the row through `loadSession` (which already enforces both
 *      sliding expiry and hard cap).
 *   3. Load the owning user. Soft-deleted or unknown users → 401.
 *   4. Slide the session window forward via `touchSession`.
 *   5. Attach `req.session` and `req.user` for downstream handlers.
 *
 * Failure mode: every 401 returns the same `AuthError("auth.unauthenticated")`
 * shape; we never branch the message on "expired" vs "no row" vs "user
 * disabled" because that would leak whether the cookie value matched a
 * row at all.
 */

import type { RequestHandler } from "express";

import type { PrismaClient } from "@facturador/db";
import { AuthError } from "@facturador/utils/errors";

import { readSessionCookie } from "./cookies.js";
import { loadSession, touchSession } from "./session-store.js";

export interface RequireSessionDeps {
  prisma: PrismaClient;
}

/**
 * Factory so the middleware can receive an injected Prisma client (the
 * factory pattern used by `createApp` already wires one). Tests pass a
 * per-schema client; production passes the singleton.
 */
export function buildRequireSession(deps: RequireSessionDeps): RequestHandler {
  const { prisma } = deps;

  return async function requireSession(req, _res, next) {
    try {
      const sessionId = readSessionCookie(req);
      if (sessionId === undefined) {
        throw new AuthError();
      }

      const session = await loadSession(prisma, sessionId);
      if (session === null) {
        throw new AuthError();
      }

      const user = await prisma.user.findUnique({ where: { id: session.userId } });
      if (user === null || user.deletedAt !== null) {
        throw new AuthError();
      }

      // Slide the window forward. Best-effort: if the UPDATE fails for any
      // reason other than a concurrent delete, we still let the request
      // through — the user has a valid session, the slide is a UX nicety.
      await touchSession(prisma, session).catch(() => {
        // Swallow: failure to slide is non-fatal for this request.
      });

      req.session = session;
      req.user = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isSuperadmin: user.isSuperadmin,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
