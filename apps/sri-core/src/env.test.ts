/**
 * Unit tests for `apps/sri-core/src/env.ts`.
 *
 * Covers PROMPT-0020 §6 + TASKS-0020 §2.1:
 *   - Happy path: a complete payload parses without errors.
 *   - Refine rejection: production + SRI_STUB_MODE=true throws an Error whose
 *     message contains the `stub_mode_in_production` sentinel — which is what
 *     the PROMPT-0020 §7.2 refuse-to-boot test grep against.
 *   - Missing required keys produce a precise message.
 *
 * We import `parseEnv` and feed it a synthetic object so the test never
 * mutates `process.env` (which would bleed across worker threads in
 * parallel vitest runs).
 */
import { describe, expect, it } from "vitest";
import { parseEnv, SriCoreEnvSchema } from "./env.js";

const baseValid: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  LOG_LEVEL: "info",
  SRI_CORE_PORT: "3100",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/facturador?schema=public",
  SERVICE_JWT_SECRET: "x".repeat(48),
  SRI_RECEPCION_URL_PRUEBAS: "https://celcer.sri.gob.ec/recepcion",
  SRI_AUTORIZACION_URL_PRUEBAS: "https://celcer.sri.gob.ec/autorizacion",
  SRI_RECEPCION_URL_PRODUCCION: "https://cel.sri.gob.ec/recepcion",
  SRI_AUTORIZACION_URL_PRODUCCION: "https://cel.sri.gob.ec/autorizacion",
  SRI_HTTP_TIMEOUT_MS: "30000",
  SRI_CERT_MASTER_KEY_HEX: "0".repeat(64),
  SRI_STUB_MODE: "false",
};

describe("parseEnv — happy path", () => {
  it("parses a complete development payload", () => {
    const env = parseEnv(baseValid);
    expect(env.NODE_ENV).toBe("development");
    expect(env.SRI_STUB_MODE).toBe(false);
    expect(env.SRI_CORE_PORT).toBe(3100);
    expect(env.SERVICE_JWT_SECRET).toHaveLength(48);
  });

  it('coerces SRI_STUB_MODE="true" to a real boolean', () => {
    const env = parseEnv({ ...baseValid, SRI_STUB_MODE: "true" });
    expect(env.SRI_STUB_MODE).toBe(true);
  });

  it("defaults SRI_HTTP_TIMEOUT_MS to 30000 when omitted", () => {
    const env = parseEnv({
      ...baseValid,
      SRI_HTTP_TIMEOUT_MS: undefined,
    });
    expect(env.SRI_HTTP_TIMEOUT_MS).toBe(30_000);
  });
});

describe("parseEnv — refusals", () => {
  it("rejects NODE_ENV=production with SRI_STUB_MODE=true (stub_mode_in_production)", () => {
    expect(() =>
      parseEnv({ ...baseValid, NODE_ENV: "production", SRI_STUB_MODE: "true" }),
    ).toThrowError(/stub_mode_in_production/);
  });

  it("allows NODE_ENV=production with SRI_STUB_MODE=false", () => {
    expect(() =>
      parseEnv({ ...baseValid, NODE_ENV: "production", SRI_STUB_MODE: "false" }),
    ).not.toThrow();
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv({ ...baseValid, DATABASE_URL: undefined })).toThrowError(/DATABASE_URL/);
  });

  it("rejects a short SERVICE_JWT_SECRET", () => {
    expect(() => parseEnv({ ...baseValid, SERVICE_JWT_SECRET: "tooshort" })).toThrowError(
      /SERVICE_JWT_SECRET/,
    );
  });

  it("rejects a non-URL SRI endpoint", () => {
    expect(() => parseEnv({ ...baseValid, SRI_RECEPCION_URL_PRUEBAS: "not-a-url" })).toThrowError(
      /SRI_RECEPCION_URL_PRUEBAS/,
    );
  });
});

describe("SriCoreEnvSchema export", () => {
  it("safeParse returns success: false on the bad combo (for direct callers)", () => {
    const result = SriCoreEnvSchema.safeParse({
      ...baseValid,
      NODE_ENV: "production",
      SRI_STUB_MODE: "true",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.flatten())).toContain("stub_mode_in_production");
  });
});

describe("SRI_CERT_MASTER_KEY_HEX strict validation (non-stub)", () => {
  // SPEC-0021 §6.1 / PROMPT-0021 hard rule: in non-stub mode the master
  // key must be EXACTLY 64 hex characters. Stub mode keeps the loose
  // min-length check so the dev `.env.example` placeholder still boots.
  const valid = "abcd".repeat(16); // 64 hex chars

  it("accepts a 64-char hex key in non-stub mode", () => {
    expect(() =>
      parseEnv({ ...baseValid, SRI_STUB_MODE: "false", SRI_CERT_MASTER_KEY_HEX: valid }),
    ).not.toThrow();
  });

  it("rejects a non-hex master key in non-stub mode (invalid_master_key)", () => {
    expect(() =>
      parseEnv({
        ...baseValid,
        SRI_STUB_MODE: "false",
        SRI_CERT_MASTER_KEY_HEX: "Z".repeat(64),
      }),
    ).toThrowError(/invalid_master_key/);
  });

  it("rejects a short master key in non-stub mode (invalid_master_key)", () => {
    expect(() =>
      parseEnv({
        ...baseValid,
        SRI_STUB_MODE: "false",
        SRI_CERT_MASTER_KEY_HEX: "ab".repeat(16), // 32 hex chars = 16 bytes, wrong
      }),
    ).toThrowError(/invalid_master_key/);
  });

  it("allows a placeholder master key in stub mode (dev .env.example)", () => {
    expect(() =>
      parseEnv({
        ...baseValid,
        SRI_STUB_MODE: "true",
        SRI_CERT_MASTER_KEY_HEX: "change_me_to_64_lowercase_hex_chars__________________________dev",
      }),
    ).not.toThrow();
  });
});
