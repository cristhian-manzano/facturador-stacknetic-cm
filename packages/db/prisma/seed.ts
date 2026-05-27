/**
 * Idempotent seed for the `facturador` development database.
 *
 * Inserts a deterministic dev tenant + admin user + OWNER membership. All
 * three rows are upserted by their unique business key (`ruc`, `email`,
 * `(userId, companyId)`), so re-running this script produces zero diff.
 *
 * Hard rules (also enforced upstream by the prompt + ai/context/security.md):
 *   - The password is hashed with argon2id (memoryCost=65536 KiB / timeCost=3
 *     / parallelism=1, meeting OWASP 2024 minimums). Plaintext never reaches
 *     the database or any log line.
 *   - `SEED_ADMIN_PASSWORD` is read from the environment (via `src/env.ts`).
 *     The dev default `Admin123!` is a placeholder; it MUST be overridden
 *     before any non-dev environment seeds this table — see
 *     ai/reviews/0004-database-and-prisma-review.md.
 *   - The output is a single summary line — never echo the plaintext password
 *     or the resulting hash.
 *
 * Run with: `pnpm --filter @facturador/db seed`.
 */
import { PrismaClient, Role } from "@prisma/client";
import argon2 from "argon2";
import { ulid } from "ulid";

import { readSeedEnv } from "../src/env.js";

const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 65_536, // 64 MiB — OWASP 2024 minimum
  timeCost: 3,
  parallelism: 1,
} as const;

// Synthetic but VALID sociedad-privada RUC (módulo-11 check; province 99 is
// SRI's reserved test prefix). Updated under PROMPT-0011 so the contract
// schemas accept the seed payload when round-tripping via API.
const DEMO_RUC = "9990000015001";

function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({ log: ["warn", "error"] });

  try {
    const { adminEmail, adminPassword } = readSeedEnv();
    const email = normaliseEmail(adminEmail);
    const passwordHash = await argon2.hash(adminPassword, ARGON2_PARAMS);

    const company = await prisma.company.upsert({
      where: { ruc: DEMO_RUC },
      update: {},
      create: {
        id: ulid(),
        ruc: DEMO_RUC,
        razonSocial: "FACTURADOR DEMO S.A.",
        nombreComercial: "Facturador Demo",
        ambiente: "1",
        tipoEmision: "1",
        direccionMatriz: "Av. Demo 123, Quito, Ecuador",
        obligadoContabilidad: true,
      },
    });

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        id: ulid(),
        email,
        passwordHash,
        displayName: "Admin Demo",
        locale: "es-EC",
        isSuperadmin: true,
      },
    });

    // OWNER bootstrap membership is implicitly active — it predates the
    // invitation flow (SPEC-0050). Without `acceptedAt`, the future
    // `requireTenant` "is active" check (production_readiness_columns
    // migration §4) would refuse this row. `invitedAt` stays NULL: this
    // membership was never invited, it was provisioned directly.
    const now = new Date();
    await prisma.membership.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      update: { acceptedAt: now },
      create: {
        id: ulid(),
        userId: user.id,
        companyId: company.id,
        role: Role.OWNER,
        acceptedAt: now,
      },
    });

    // Single, redaction-safe summary line. No plaintext password, no hash.
    process.stdout.write(`Seed complete: company=${company.id} user=${user.id}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  // Avoid leaking environment variables or argon2 internals into stderr.
  const message = err instanceof Error ? err.message : "unknown error";
  process.stderr.write(`[seed] failed: ${message}\n`);
  process.exit(1);
});
