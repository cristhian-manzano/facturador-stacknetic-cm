/**
 * Conservative JSON walker that mirrors the logger's `REDACT_PATHS` list.
 *
 * Pino's fast-redact runs inside the logger's serialisation pipeline; this
 * helper provides the equivalent protection for `AuditLog.payloadJson`,
 * which is persisted through Prisma and therefore bypasses the logger
 * entirely.
 *
 * Strategy: a recursive walker checks every property name against the
 * `SENSITIVE_KEYS` set derived from `REDACT_PATHS` (we drop the wildcards
 * and bracket forms; what's left is a plain Set of field names). Keys
 * that match are replaced with `"[REDACTED]"`; everything else passes
 * through. Circular references are short-circuited with a marker.
 */
import { REDACT_PATHS } from "@facturador/logger";

/**
 * Build the set of field names from REDACT_PATHS:
 *   - `*.password` → `password`
 *   - `password`   → `password`
 *   - `req.headers.authorization` → `authorization`
 *   - `res.headers["set-cookie"]` → `set-cookie`
 */
const buildSensitiveKeys = (): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const path of REDACT_PATHS) {
    // Extract the final segment, stripping wildcards and bracket access.
    // We deliberately split on both `.` and bracket notation.
    const cleaned = path.replace(/\[(["'])([^"']+)\1\]/g, ".$2").replace(/^\*\./, "");
    const segments = cleaned.split(".");
    const last = segments[segments.length - 1];
    if (last && last !== "*") keys.add(last);
  }
  return keys;
};

export const SENSITIVE_KEYS: ReadonlySet<string> = buildSensitiveKeys();

const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";

/**
 * Deeply clone the input, replacing values at any sensitive-named key with
 * `"[REDACTED]"`. Untouched primitives, arrays, and objects retain their
 * structure. Does NOT mutate the input.
 */
export function redactPayload(value: unknown): unknown {
  return redactInternal(value, new WeakSet());
}

function redactInternal(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (seen.has(value)) return CIRCULAR;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactInternal(item, seen));
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map || value instanceof Set || value instanceof RegExp) {
    // Drop opaque rich types to keep the payload JSON-safe.
    return undefined;
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactInternal(obj[key], seen);
  }
  return out;
}
