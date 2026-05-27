/**
 * Health + readiness routes.
 *
 * Source of truth:
 *   - SPEC-0020 §FR-7, TASKS-0020 §4.1, PROMPT-0020 finishing
 *     validations ("`curl -fsS http://localhost:3100/healthz` returns 200").
 *   - audit-punchlist Item 12 (REVIEW-0026 §10 #4): `/readyz` now also
 *     reports stale (503) when the polling job hasn't completed a batch
 *     in the last 5 minutes.
 *
 *   - `GET /healthz` — process-level liveness. Returns 200 as long as the
 *     event loop is alive. Used by the docker-compose healthcheck.
 *   - `GET /readyz`  — readiness. Pings the DB with `SELECT 1` AND checks
 *     the polling health stamp. Returns 503 if either is down/stale.
 *     The error body NEVER includes the underlying DSN / pg error string
 *     (security.md: log codes, not bodies).
 */
import { Router, type Request, type Response } from "express";

import type { PrismaClient } from "@facturador/db";

import { POLLING_STALENESS_THRESHOLD_MS, type PollingHealthState } from "../jobs/polling-health.js";

export interface HealthOkBody {
  readonly status: "ok";
  readonly service: "sri-core";
  readonly uptimeSec: number;
}

export interface ReadyOkBody {
  readonly status: "ready";
  readonly db: "ok";
  readonly polling: "ok" | "uninitialized";
  readonly lastPollAtMs: number | null;
}

export interface ReadyErrorBody {
  readonly status: "down";
  readonly db?: "down" | "ok";
  readonly polling?: "stale" | "ok" | "uninitialized";
  readonly lastPollAtMs?: number | null;
}

export interface BuildHealthRouterDeps {
  readonly prisma: PrismaClient;
  /**
   * Optional polling-health state. When omitted, `/readyz` skips the
   * staleness check entirely (e.g. in test apps that don't start a
   * polling scheduler). When set, `/readyz` returns 503 if the last
   * batch completed > 5 minutes ago.
   */
  readonly pollingHealth?: PollingHealthState;
  /** Clock override (test seam). */
  readonly nowMs?: () => number;
}

export function buildHealthRouter(deps: BuildHealthRouterDeps): Router {
  const router = Router();
  const nowMs = deps.nowMs ?? Date.now;

  router.get("/healthz", (_req: Request, res: Response<HealthOkBody>) => {
    res.json({
      status: "ok",
      service: "sri-core",
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  router.get("/readyz", async (_req: Request, res: Response<ReadyOkBody | ReadyErrorBody>) => {
    // 1. DB check.
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
    } catch {
      res.status(503).json({ status: "down", db: "down" });
      return;
    }

    // 2. Polling staleness check (when wired).
    if (deps.pollingHealth !== undefined) {
      const last = deps.pollingHealth.lastBatchAtMs();
      const ageMs = last === null ? null : nowMs() - last;
      // First boot (last === null) is treated as "uninitialized" not
      // stale — the scheduler may not have ticked yet. Operators can
      // distinguish via the `polling` field. We still return 200 to
      // avoid flapping the readiness gate during the warm-up window.
      if (last !== null && ageMs !== null && ageMs > POLLING_STALENESS_THRESHOLD_MS) {
        res.status(503).json({
          status: "down",
          db: "ok",
          polling: "stale",
          lastPollAtMs: last,
        });
        return;
      }
      res.status(200).json({
        status: "ready",
        db: "ok",
        polling: last === null ? "uninitialized" : "ok",
        lastPollAtMs: last,
      });
      return;
    }

    // No polling state wired (e.g. test app without scheduler) — DB-only
    // readiness preserves the pre-audit behaviour.
    res.status(200).json({
      status: "ready",
      db: "ok",
      polling: "uninitialized",
      lastPollAtMs: null,
    });
  });

  return router;
}
