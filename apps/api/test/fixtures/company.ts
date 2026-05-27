/**
 * `companyFactory` — synthetic Company fixture for `@facturador/api` tests.
 *
 * Hard rules (PROMPT-0007 §6 / TASKS-0007 §5):
 *
 *   - RUC starts with `9999` and passes the RUC schema's checksum.  The
 *     defaults below are pre-computed valid sociedad RUCs (third digit `9`,
 *     suffix `001`); the helper `validNineNineRuc(n)` produces additional
 *     unique ones if the test needs many tenants.
 *   - No real customer or business names.
 *   - Timestamps are ISO strings so the factory output validates through
 *     `TenantSchema` for assertion purposes; the DB layer accepts Date.
 *
 * Returns a plain object suitable for `prisma.company.create({ data: ... })`
 * after `id` is provided (the factory mints one via ULID).
 */
import { TenantSchema, type Tenant } from "@facturador/contracts/tenants";

import { newId } from "./_ids.js";

/** Synthetic RUC table — all start with `9999`, all valid checksum. */
export const SYNTHETIC_RUCS = [
  "9999000001001",
  "9999000018001",
  "9999000026001",
  "9999000034001",
  "9999000042001",
  "9999000050001",
] as const;

export interface CompanyFixture {
  id: string;
  ruc: string;
  razonSocial: string;
  nombreComercial: string | null;
  ambiente: "1" | "2";
  tipoEmision: "1" | "2";
  direccionMatriz: string;
  contribuyenteEspecial: string | null;
  obligadoContabilidad: boolean;
}

/**
 * Build a synthetic Company.  `overrides` lets a test pin any field
 * (e.g. a known `ruc` for unique-constraint negative tests).
 */
export function companyFactory(overrides: Partial<CompanyFixture> = {}): CompanyFixture {
  return {
    id: newId(),
    ruc: SYNTHETIC_RUCS[0],
    razonSocial: "SYNTHETIC TENANT S.A.",
    nombreComercial: "Synthetic",
    ambiente: "1",
    tipoEmision: "1",
    direccionMatriz: "Av. Sintetica 1, Quito",
    contribuyenteEspecial: null,
    obligadoContabilidad: false,
    ...overrides,
  };
}

/**
 * Convert a `CompanyFixture` to the wire-shaped `Tenant` payload that
 * `TenantSchema.parse` accepts — useful when a test wants to validate that
 * the fixture would round-trip through the contract.
 */
export function companyToTenant(
  c: CompanyFixture,
  timestamps?: { createdAt?: string; updatedAt?: string },
): Tenant {
  const now = new Date().toISOString();
  // Parse through the canonical schema so the returned object carries the
  // brand types — this lets callers feed the result back into other
  // contract-typed APIs without a manual `as` cast.
  return TenantSchema.parse({
    id: c.id,
    ruc: c.ruc,
    razonSocial: c.razonSocial,
    nombreComercial: c.nombreComercial,
    direccionMatriz: c.direccionMatriz,
    ambiente: c.ambiente,
    contribuyenteEspecial: c.contribuyenteEspecial,
    obligadoContabilidad: c.obligadoContabilidad,
    contribuyenteRimpe: null,
    createdAt: timestamps?.createdAt ?? now,
    updatedAt: timestamps?.updatedAt ?? now,
  });
}
