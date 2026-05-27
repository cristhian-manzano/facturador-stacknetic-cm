/**
 * Tests for the Prometheus `/metrics` endpoint.
 *
 * Covers audit-punchlist Item 10:
 *   - GET /metrics returns 200 + Prometheus text format.
 *   - The four named metric series are present in the output.
 *   - No authentication required (the scraper firewall handles it).
 */
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { sriRequestTotal } from "../metrics.js";

import { buildMetricsRouter } from "./metrics.js";

function appWithMetrics() {
  const app = express();
  app.use(buildMetricsRouter());
  return app;
}

describe("GET /metrics", () => {
  it("returns 200 with Prometheus text format content-type", async () => {
    // Touch the counter so the series shows up in the output.
    sriRequestTotal.inc({ ambiente: "1", outcome: "recibida" });
    const res = await request(appWithMetrics()).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
    const body = res.text;
    expect(body).toContain("# HELP sri_request_total");
    expect(body).toContain("sri_request_total{");
  });

  it("exposes the four punchlist metric series in the output", async () => {
    // Touch each counter once so the lines appear.
    sriRequestTotal.inc({ ambiente: "1", outcome: "autorizado" });
    const res = await request(appWithMetrics()).get("/metrics");
    expect(res.status).toBe(200);
    const body = res.text;
    // Each of the four series should be declared via HELP.
    expect(body).toContain("# HELP sri_request_total");
    expect(body).toContain("# HELP sri_request_duration_seconds");
    expect(body).toContain("# HELP sri_document_transitions_total");
    expect(body).toContain("# HELP sri_step_duration_ms");
  });
});
