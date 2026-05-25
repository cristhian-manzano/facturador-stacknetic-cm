/**
 * Login / logout / me handlers.
 *
 * Source of truth:
 *   - SPEC-0010 §6.3 (login sketch + constant-time policy).
 *   - SPEC-0005 §6.5 (LoginRequest / LoginResponse / MeResponse).
 *   - TASKS-0010 §5.1.
 *   - PLAN-0010 §4 phase 3.
 *   - ai/context/security.md (do-not-log list + generic 401 message).
 *
 * Constant-time login policy (the HARD constraint):
 *   - The "unknown email" path MUST consume the same argon2 verify work
 *     as the "known email + bad password" path. We do this with
 *     `DUMMY_HASH` from `password.ts`.
 *   - The 401 response body is BYTE-IDENTICAL for both failure paths
 *     except for the `instance` (request id). We build the body
 *     manually with a fixed message — never branching on cause.
 *   - We use `validateBody(LoginRequestSchema)` to parse, so input shape
 *     errors return 400 BEFORE we look anything up. That means we never
 *     get to the "is the email known?" code path without a valid request
 *     shape — preventing a different oracle (different timing or
 *     different body) for malformed input.
 *
 * Audit events emitted (via `@facturador/utils/audit`):
 *   - `auth.login.success` on success (entityId = sessionId).
 *   - `auth.login.failure` on failure (reason = `bad_credentials`; never
 *      the attempted password).
 *   - `auth.logout` on logout.
 *
 * The handlers are factory-built (`buildAuthHandlers({ prisma, logger })`)
 * so tests inject per-schema Prisma and a sink-configured logger.
 */

import type { Request, RequestHandler, Response } from "express";
import type { PrismaClient } from "@facturador/db";
import {
  LoginRequestSchema,
  LoginResponseSchema,
  MeResponseSchema,
} from "@facturador/contracts/auth";
import type { LoginResponse, MeResponse } from "@facturador/contracts/auth";
import { AuthError } from "@facturador/utils/errors";
import { audit, type AuditPrismaClient } from "@facturador/utils/audit";
import { actionsForRole, type Role } from "@facturador/utils/rbac";
import type { Logger } from "@facturador/logger";
import { clearSessionCookies, setSessionCookies } from "./cookies.js";
import { DUMMY_HASH, verifyPassword } from "./password.js";
import { createSession, deleteSession } from "./session-store.js";

/**
 * Audit dependency adapter. The audit helper's `AuditPrismaClient` interface
 * accepts `payloadJson: unknown` to keep the helper generic, but Prisma's
 * generated `auditLog.create` signature is stricter (it expects
 * `Prisma.InputJsonValue`). The runtime structure is identical; only the
 * type declarations diverge. We cast through `unknown` once here so the
 * call sites stay readable. The same pattern is used by
 * `packages/utils/src/audit/audit.test.ts`.
 */
const auditAdapter = (prisma: PrismaClient): AuditPrismaClient =>
  prisma as unknown as AuditPrismaClient;

export interface AuthHandlerDeps {
  prisma: PrismaClient;
  logger: Logger;
}

export interface AuthHandlers {
  login: RequestHandler;
  logout: RequestHandler;
  me: RequestHandler;
}

function readIp(req: Request): string | null {
  const raw = req.ip;
  return typeof raw === "string" && raw.length > 0 ? raw.slice(0, 64) : null;
}

function readUserAgent(req: Request): string | null {
  const raw = req.header("user-agent");
  return typeof raw === "string" && raw.length > 0 ? raw.slice(0, 256) : null;
}

/**
 * Build the generic 401 error used by all login failure paths. Calling
 * `throw new AuthError(...)` lets the terminal error middleware render a
 * canonical `ProblemDetail` with the same shape (status, code, title,
 * detail, instance) — only `instance` differs between requests.
 *
 * The Spanish message is the project's user-facing string; English code
 * is the stable identifier consumers may switch on.
 */
function genericLoginFailure(): AuthError {
  return new AuthError("Credenciales inválidas", "auth.invalid_credentials");
}

interface ActiveMembershipRow {
  companyId: string;
  role: "OWNER" | "ADMIN" | "ACCOUNTANT" | "OPERATOR" | "VIEWER";
  company: { razonSocial: string };
}

/**
 * Project the Prisma `Membership` rows into the contract's
 * `MembershipSummary` shape. We don't apply branded types here — the final
 * `LoginResponseSchema.parse()` / `MeResponseSchema.parse()` brands the
 * `companyId` field at the response boundary.
 */
interface RawMembershipSummary {
  companyId: string;
  razonSocial: string;
  role: ActiveMembershipRow["role"];
}

function toMembershipSummariesRaw(rows: readonly ActiveMembershipRow[]): RawMembershipSummary[] {
  return rows.map((m) => ({
    companyId: m.companyId,
    razonSocial: m.company.razonSocial,
    role: m.role,
  }));
}

export function buildAuthHandlers(deps: AuthHandlerDeps): AuthHandlers {
  const { prisma, logger } = deps;

  const login: RequestHandler = async (req: Request, res: Response, next) => {
    try {
      // Parse manually here (rather than via `validateBody`) so we don't
      // depend on the handler being mounted under a specific stack. The
      // route mounts `validateBody(LoginRequestSchema)` BEFORE this
      // handler, so `req.body` is already the parsed shape.
      const parsed = LoginRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        // Defensive: the route mounts `validateBody` ahead of this handler
        // and that throws 400 first. If a future route forgets the
        // validator, we still refuse to proceed.
        throw genericLoginFailure();
      }
      const { email, password } = parsed.data;

      // Lookup. Email is already lowercased by `EmailSchema`.
      const user = await prisma.user.findUnique({ where: { email } });

      // Constant-time path: ALWAYS run verifyPassword once. When the user
      // is unknown we verify against the pre-computed `DUMMY_HASH` so the
      // argon2 cost is paid regardless. The boolean we keep is for the
      // success branch — failure flow doesn't read it.
      const passwordOk =
        user === null || user.deletedAt !== null
          ? await verifyPassword(DUMMY_HASH, password)
          : await verifyPassword(user.passwordHash, password);

      if (user === null || user.deletedAt !== null || !passwordOk) {
        // Audit the failure WITHOUT the password and WITHOUT the email.
        // Even the email is sensitive (it would leak which addresses are
        // probed). We record the IP + a non-identifying reason.
        await audit(
          { prisma: auditAdapter(prisma), logger },
          {
            action: "auth.login.failure",
            entity: "Session",
            actorUserId: null,
            companyId: null,
            ip: readIp(req),
            userAgent: readUserAgent(req),
            payloadJson: { reason: "bad_credentials" },
          },
        );
        throw genericLoginFailure();
      }

      // Active memberships only: revokedAt was added in SPEC-0011 but is
      // not yet in this baseline schema (see prisma/schema.prisma). The
      // baseline `Membership` model has no `revokedAt` column, so all
      // membership rows are considered active.
      const memberships = await prisma.membership.findMany({
        where: { userId: user.id },
        include: { company: true },
        orderBy: { createdAt: "asc" },
      });

      // companyId stays null until SPEC-0011 wires tenant switching.
      const activeCompanyId: string | null = null;

      const { sessionId, csrfToken } = await createSession(prisma, {
        userId: user.id,
        companyId: null,
        ip: readIp(req),
        userAgent: readUserAgent(req),
      });

      setSessionCookies(res, { sessionId, csrfToken });

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "auth.login.success",
          entity: "Session",
          entityId: sessionId,
          actorUserId: user.id,
          companyId: null,
          ip: readIp(req),
          userAgent: readUserAgent(req),
          payloadJson: { membershipsCount: memberships.length },
        },
      );

      // Build the response through the contract schema so branded types
      // (Ulid, Email) are validated end-to-end. Any drift between the DB
      // row and the contract is a 500 caught by the error middleware.
      const body: LoginResponse = LoginResponseSchema.parse({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
        memberships: toMembershipSummariesRaw(memberships),
        activeCompanyId,
        csrfToken,
      });
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  };

  const logout: RequestHandler = async (req, res, next) => {
    try {
      const session = req.session;
      if (session === undefined) {
        // `requireSession` should already have thrown 401; defensive guard.
        throw new AuthError();
      }
      await deleteSession(prisma, session.id);
      clearSessionCookies(res);

      await audit(
        { prisma: auditAdapter(prisma), logger },
        {
          action: "auth.logout",
          entity: "Session",
          entityId: session.id,
          actorUserId: session.userId,
          companyId: session.companyId,
          ip: readIp(req),
          userAgent: readUserAgent(req),
        },
      );

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  const me: RequestHandler = async (req, res, next) => {
    try {
      const user = req.user;
      if (user === undefined) {
        throw new AuthError();
      }
      const memberships = await prisma.membership.findMany({
        where: { userId: user.id },
        include: { company: true },
        orderBy: { createdAt: "asc" },
      });

      // Derive the current role + permissions from the SERVER session row's
      // `companyId`. NEVER from a query / header / body — the contract is
      // that the active tenant lives only in `Session.companyId`.
      const activeCompanyId = req.session?.companyId ?? null;
      let currentRole: Role | null = null;
      if (activeCompanyId !== null) {
        const currentMembership = memberships.find((m) => m.companyId === activeCompanyId);
        if (currentMembership !== undefined) {
          currentRole = currentMembership.role as Role;
        }
      }
      const permissions: string[] = currentRole === null ? [] : [...actionsForRole(currentRole)];

      const body: MeResponse = MeResponseSchema.parse({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
        memberships: toMembershipSummariesRaw(memberships),
        activeCompanyId,
        currentRole,
        permissions,
      });
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  };

  return { login, logout, me };
}
