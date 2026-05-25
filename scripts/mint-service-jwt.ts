#!/usr/bin/env -S node --no-warnings=ExperimentalWarning --experimental-strip-types
/**
 * `scripts/mint-service-jwt.ts` — mint a one-shot HS256 service JWT for
 * the api ⇒ sri-core surface. Used in manual curl tests, per
 * TASKS-0020 §8.2.
 *
 * Usage:
 *   ```bash
 *   pnpm --filter @facturador/scripts mint-service-jwt <companyId>
 *   # → eyJhbGciOiJIUzI1NiI...
 *
 *   # full curl smoke against a running compose stack:
 *   TOKEN=$(pnpm --filter @facturador/scripts mint-service-jwt 01HXYZ...)
 *   curl -H "Authorization: Bearer $TOKEN" -i \
 *     http://localhost:3100/v1/documents/<claveAcceso>/status
 *   ```
 *
 * The script reads `SERVICE_JWT_SECRET` from the environment (the same
 * `.env` compose uses). The token has `exp = iat + 60s`.
 *
 * The script is intentionally self-contained: it does NOT import
 * `@facturador/utils/service-jwt`. That helper IS the source of truth
 * for runtime behaviour; this script duplicates the wire layer (≈ 30
 * lines) so it can run from any pnpm workspace without the resolver
 * walking back into the monorepo. The duplicated logic is a one-shot
 * SignJWT call with the same claims contract; see SPEC-0020 §6.3.
 *
 * Output: stdout only.
 */
import process from "node:process";
import { SignJWT } from "jose";
import { ulid } from "ulid";

const ISSUER = "api";
const AUDIENCE = "sri-core";
const TTL_SECONDS = 60;

async function main(): Promise<void> {
  const [companyId] = process.argv.slice(2);
  if (companyId === undefined || companyId.length === 0) {
    process.stderr.write("usage: tsx scripts/mint-service-jwt.ts <companyId>\n");
    process.exit(1);
  }
  const secret = process.env["SERVICE_JWT_SECRET"];
  if (secret === undefined || secret.length === 0) {
    process.stderr.write("SERVICE_JWT_SECRET is required (set in .env or shell env)\n");
    process.exit(1);
  }
  const key = new TextEncoder().encode(secret);
  const nowSec = Math.floor(Date.now() / 1000);
  const jti = ulid();
  const token = await new SignJWT({ jti })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(companyId)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + TTL_SECONDS)
    .setJti(jti)
    .sign(key);
  process.stdout.write(`${token}\n`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`mint-service-jwt failed: ${message}\n`);
  process.exit(1);
});
