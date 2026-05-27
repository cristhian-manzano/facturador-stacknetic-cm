-- REVIEW-0044 §HIGH-2 — BurnedSecuencial unique constraint must include tipoComprobante.
--
-- The original `(companyId, estab, ptoEmi, secuencial)` unique constraint
-- predates the per-(emissionPoint, codDoc) sequencing rule introduced
-- by SPEC-0030. Under that rule, a factura (tipoComprobante = '01') and
-- a nota crédito (tipoComprobante = '04') legitimately share the same
-- (estab, ptoEmi) AND can independently emit the same `secuencial`
-- value (each tipo has its own SecuencialCounter). The pre-existing
-- 4-tuple uniqueness wrongly rejected that, surfacing as
-- `P2002` Prisma errors at burn time during a nota-crédito flow.
--
-- This migration:
--   1. Drops the old 4-tuple unique index.
--   2. Creates the new 5-tuple unique index that includes tipoComprobante.
--
-- Both operations are safe to run with data present because every
-- existing row has tipoComprobante = '01' (the default backfilled in
-- `20260521225256_billing_emission_points`); the new key strictly
-- widens the existing key and cannot create duplicates.

-- DropIndex
DROP INDEX "BurnedSecuencial_companyId_estab_ptoEmi_secuencial_key";

-- CreateIndex
CREATE UNIQUE INDEX "BurnedSecuencial_companyId_estab_ptoEmi_tipoComprobante_sec_key" ON "BurnedSecuencial"("companyId", "estab", "ptoEmi", "tipoComprobante", "secuencial");
