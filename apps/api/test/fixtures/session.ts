/**
 * `sessionFactory` — synthetic Session fixture (TASKS-0007 §5.2).
 *
 * The DB model stores a hash of the CSRF secret, never the raw value.  The
 * factory produces a 32-byte random hex token + its sha256 to mirror the
 * production write path (see SPEC-0010 §FR-5).
 *
 * `expiresAt` defaults to now + 8h, matching SESSION_TTL_MIN in `.env.example`.
 */
import { createHash, randomBytes } from "node:crypto";
import { newId } from "./_ids.js";

export interface SessionFixture {
  id: string;
  userId: string;
  companyId: string | null;
  /** Raw CSRF secret returned to the browser; never persisted in this form. */
  csrfTokenSecret: string;
  /** sha256(csrfTokenSecret) — what the DB stores. */
  csrfTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export interface SessionFactoryInput {
  userId: string;
  companyId?: string | null;
  ttlMin?: number;
  ip?: string | null;
  userAgent?: string | null;
}

export function sessionFactory(input: SessionFactoryInput): SessionFixture {
  const secret = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(secret).digest("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + (input.ttlMin ?? 480) * 60_000);
  return {
    id: newId(),
    userId: input.userId,
    companyId: input.companyId ?? null,
    csrfTokenSecret: secret,
    csrfTokenHash: hash,
    createdAt: now,
    expiresAt: expires,
    lastSeenAt: now,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? "Vitest/2 (FixtureClient)",
  };
}
