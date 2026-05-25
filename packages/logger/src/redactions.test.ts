/**
 * Tests for `REDACT_PATHS`. Per TASKS-0006 §2.2.
 *
 * Asserts:
 *   - It is a non-empty array (frozen, so attempting to push throws).
 *   - Every required entry from PLAN-0006 §4 Phase 2 + SPEC-0006 §6.3 is
 *     present (the list may be extended; never reduced).
 */
import { describe, expect, it } from "vitest";
import { REDACT_PATHS } from "./redactions.js";

describe("REDACT_PATHS", () => {
  it("is a non-empty, immutable string array", () => {
    expect(Array.isArray(REDACT_PATHS)).toBe(true);
    expect(REDACT_PATHS.length).toBeGreaterThanOrEqual(12);
    expect(Object.isFrozen(REDACT_PATHS)).toBe(true);
  });

  // The exact list from PLAN-0006 §4 Phase 2 + SPEC-0006 §6.3. Any of
  // these missing is a security-policy violation.
  const REQUIRED_PATHS = [
    "req.headers.authorization",
    "req.headers.cookie",
    'res.headers["set-cookie"]',
    "*.password",
    "*.passwordHash",
    "*.passphrase",
    "*.csrfSecret",
    "*.p12",
    "*.p12Buffer",
    "*.pfx",
    "*.pem",
    "*.privateKey",
    "*.certificatePassphrase",
    "*.signedXml",
    "*.xml",
    "*.rawSoapResponse",
    "*.cedula",
    "*.identificacionComprador",
    "*.razonSocialComprador",
    "*.email",
    "*.telefono",
    "*.direccionComprador",
    "*.SERVICE_JWT_SECRET",
    "*.SRI_CERT_MASTER_KEY_HEX",
  ] as const;

  it.each(REQUIRED_PATHS)("includes %s", (path) => {
    expect(REDACT_PATHS).toContain(path);
  });

  it("contains no duplicates", () => {
    const set = new Set(REDACT_PATHS);
    expect(set.size).toBe(REDACT_PATHS.length);
  });
});
