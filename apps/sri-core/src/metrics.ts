/**
 * Prometheus metrics surface for apps/sri-core.
 *
 * Source of truth:
 *   - audit-punchlist Item 10 (REVIEW-0025 §11 #2 + REVIEW-0026 §10 #3).
 *
 * Four metrics:
 *   - `sri_request_total{ambiente, outcome}` — Counter, incremented by
 *     `RecepcionClient` + `AutorizacionClient` after each round-trip.
 *     `outcome` is one of {"recibida","devuelta","autorizado","no_autorizado","en_proceso","desconocido","error","reclassified"}.
 *   - `sri_request_duration_seconds{ambiente}` — Histogram, observed
 *     with the wall-clock duration of each SRI call.
 *   - `sri_document_transitions_total{from,to}` — Counter, incremented
 *     by `recordEvent` after a successful transition.
 *   - `sri_step_duration_ms_bucket{step}` — Histogram, observed with
 *     the per-step duration recorded on the SriEvent.
 *
 * The `/metrics` endpoint serves the Prometheus text format with no
 * authentication. The scraper firewall (operator network ACLs or
 * Kubernetes NetworkPolicy) restricts access. Document this expectation
 * with the operator at deploy-time.
 */
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * Process-wide registry. Tests can construct a sibling registry for
 * isolation, but the prod path reads this one.
 */
export const registry: Registry = new Registry();

// Default Node process metrics (CPU, memory, event loop lag) — useful
// for the operator dashboard. The `prefix` keeps them under a sri
// namespace so they don't collide with other Node processes scraped
// by the same Prometheus instance.
collectDefaultMetrics({ register: registry, prefix: "sri_core_" });

/** Outcome label values for `sri_request_total`. */
export type SriRequestOutcome =
  | "recibida"
  | "devuelta"
  | "autorizado"
  | "no_autorizado"
  | "en_proceso"
  | "desconocido"
  | "error"
  | "reclassified";

export const sriRequestTotal = new Counter({
  name: "sri_request_total",
  help: "Total SRI SOAP requests grouped by ambiente + outcome.",
  labelNames: ["ambiente", "outcome"] as const,
  registers: [registry],
});

export const sriRequestDurationSeconds = new Histogram({
  name: "sri_request_duration_seconds",
  help: "Wall-clock duration of SRI SOAP calls (seconds).",
  labelNames: ["ambiente"] as const,
  // Buckets tuned for the SRI envelope: most calls 0.1-2s; long tail
  // for retries.
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const sriDocumentTransitionsTotal = new Counter({
  name: "sri_document_transitions_total",
  help: "Lifecycle-state transitions observed by recordEvent.",
  labelNames: ["from", "to"] as const,
  registers: [registry],
});

export const sriStepDurationMs = new Histogram({
  name: "sri_step_duration_ms",
  help: "Per-step duration recorded on SriEvent rows (milliseconds).",
  labelNames: ["step"] as const,
  buckets: [10, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000],
  registers: [registry],
});

/** Convenience for tests — clear every counter/histogram so each suite starts clean. */
export function _resetMetricsForTests(): void {
  registry.resetMetrics();
}
