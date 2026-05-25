/**
 * `ensureConsumidorFinal` — idempotent helper that returns the per-tenant
 * singleton "Consumidor Final" customer row (SPEC-0031 §FR-4 + §6.2).
 *
 * Source of truth:
 *   - SPEC-0031 §6.2 / §FR-4.
 *   - PLAN-0031 §4 Phase 4.
 *   - TASKS-0031 §4.
 *
 * Why this exists:
 *   - The invoice emission orchestrator (SPEC-0033) defaults sub-$50 retail
 *     sales to the Consumidor Final receptor. Instead of special-casing the
 *     XML builder, we materialise the receptor as a real `Customer` row so
 *     the rest of the pipeline treats it uniformly.
 *   - Every tenant gets its own Consumidor Final row. The helper is the
 *     single writer — the regular `POST /api/v1/customers` route rejects
 *     manual creations with `(tipoIdentificacion="07", identificacion="9999999999999")`
 *     with a 409 `customer.use_helper` so the upsert here is the only path.
 *
 * Contract:
 *
 *   ensureConsumidorFinal(tx, companyId): Promise<Customer>
 *
 *   - `tx` accepts either a `PrismaClient` or a transaction-scoped tx (the
 *     callback parameter of `prisma.$transaction(...)`). This lets the
 *     orchestrator weave the upsert into a single transaction with the
 *     invoice insert when needed.
 *
 *   - Idempotent: calling it N times leaves exactly 1 row per tenant.
 *     Postgres handles the upsert atomically against the composite-unique
 *     index `(companyId, tipoIdentificacion, identificacion)`.
 *
 * Hard rules:
 *   - `companyId` flows from server context — never the client body.
 *   - `tipoIdentificacion`, `identificacion`, and `razonSocial` are pinned
 *     to the SRI ficha-técnica literals. Callers cannot override them.
 */
import type { Customer, PrismaClient } from "@facturador/db";
import { newId } from "@facturador/db";

import {
  CONSUMIDOR_FINAL_IDENTIFICACION,
  CONSUMIDOR_FINAL_RAZON_SOCIAL,
  CONSUMIDOR_FINAL_TIPO_IDENTIFICACION,
} from "./validate.js";

/**
 * Minimal Prisma surface we need. Both a top-level client and a tx (the
 * argument handed to a `$transaction(...)` callback) implement this, so
 * callers can compose either.
 */
export type EnsureConsumidorFinalTx = Pick<PrismaClient, "customer">;

/**
 * Upsert (idempotent) the Consumidor Final row for the given tenant. Always
 * returns the persisted row. Safe to call concurrently — Postgres orders the
 * upserts against the unique index.
 */
export async function ensureConsumidorFinal(
  tx: EnsureConsumidorFinalTx,
  companyId: string,
): Promise<Customer> {
  return tx.customer.upsert({
    where: {
      companyId_tipoIdentificacion_identificacion: {
        companyId,
        tipoIdentificacion: CONSUMIDOR_FINAL_TIPO_IDENTIFICACION,
        identificacion: CONSUMIDOR_FINAL_IDENTIFICACION,
      },
    },
    update: {},
    create: {
      id: newId(),
      companyId,
      tipoIdentificacion: CONSUMIDOR_FINAL_TIPO_IDENTIFICACION,
      identificacion: CONSUMIDOR_FINAL_IDENTIFICACION,
      razonSocial: CONSUMIDOR_FINAL_RAZON_SOCIAL,
    },
  });
}
