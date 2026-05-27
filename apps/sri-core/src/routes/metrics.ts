/**
 * `GET /metrics` — Prometheus text format.
 *
 * Source of truth: audit-punchlist Item 10.
 *
 * No authentication. Scraper firewall (operator network ACLs or
 * Kubernetes NetworkPolicy) restricts access. This is the industry
 * convention for Prometheus exporters.
 */
import { Router, type Request, type Response } from "express";

import { registry } from "../metrics.js";

export function buildMetricsRouter(): Router {
  const router = Router();
  router.get("/metrics", async (_req: Request, res: Response) => {
    try {
      const body = await registry.metrics();
      res.setHeader("content-type", registry.contentType);
      res.status(200).send(body);
    } catch (err) {
      res.status(500).json({ error: "metrics_unavailable", message: String((err as Error).message) });
    }
  });
  return router;
}
