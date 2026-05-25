/**
 * Health + readiness routes.
 *
 * Source of truth: SPEC-0020 §FR-7, TASKS-0020 §4.1, PROMPT-0020 finishing
 * validations ("`curl -fsS http://localhost:3100/healthz` returns 200").
 *
 *   - `GET /healthz` — process-level liveness. Returns 200 as long as the
 *     event loop is alive. Used by the docker-compose healthcheck.
 *   - `GET /readyz`  — readiness. Pings the DB with `SELECT 1`. Returns
 *     503 if the DB is unreachable (so an orchestrator can divert traffic).
 *     The error body NEVER includes the underlying DSN / pg error string
 *     (security.md: log codes, not bodies).
 */
import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@facturador/db";

export interface HealthOkBody {
  readonly status: "ok";
  readonly service: "sri-core";
  readonly uptimeSec: number;
}

export interface ReadyOkBody {
  readonly status: "ready";
  readonly db: "ok";
}

export interface ReadyErrorBody {
  readonly status: "down";
  readonly db: "down";
}

export interface BuildHealthRouterDeps {
  readonly prisma: PrismaClient;
}

export function buildHealthRouter(deps: BuildHealthRouterDeps): Router {
  const router = Router();

  router.get("/healthz", (_req: Request, res: Response<HealthOkBody>) => {
    res.json({
      status: "ok",
      service: "sri-core",
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  router.get("/readyz", async (_req: Request, res: Response<ReadyOkBody | ReadyErrorBody>) => {
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ status: "ready", db: "ok" });
    } catch {
      res.status(503).json({ status: "down", db: "down" });
    }
  });

  return router;
}
