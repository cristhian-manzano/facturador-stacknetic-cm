-- =============================================================================
-- production_readiness_columns
-- -----------------------------------------------------------------------------
-- Consolidated production-readiness migration. Adds the columns and indexes
-- flagged in ai/reviews/.audit-punchlist.md:
--   1. Invoice          — numeroAutorizacion / fechaAutorizacion / sriDocumentId
--                         (SRI authorisation mirror) + replacesInvoiceId
--                         (reissue chain, self-relation Restrict).
--   2. Session          — ipHash (sha256 of normalised IP, deprecates raw ip).
--   3. AuditLog         — subjectHash (sha256(email) for auth.login.failure
--                         brute-force review) + payloadHash (tamper-evident
--                         audit chain head).
--   4. Membership       — invitedAt / acceptedAt (forward-compatible with
--                         SPEC-0050 invitations; backfilled so requireTenant
--                         "is active" semantics work today).
--   5. Customer         — isActive (reversible "hide from picker" flag,
--                         independent of soft-delete).
--   6. BurnedSecuencial — explicit FK on documentId → SriDocument.id with
--                         onDelete SET NULL (was a soft pointer; this
--                         migration formalises the constraint).
--
-- Wrapped in a single transaction so a partial apply rolls back cleanly.
-- All ALTER TABLE … ADD COLUMN statements use forms that take an ACCESS
-- EXCLUSIVE lock for the briefest possible window (no data rewrite — the
-- `isActive` default is constant and Postgres stores it in the catalog
-- without rewriting existing rows).
--
-- Reversibility: the column additions are reversible by dropping each
-- column individually (Prisma does not generate a down migration; the
-- catalogue equivalents are documented at the bottom of this file). The
-- backfills are idempotent.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- AlterTable: AuditLog
-- ---------------------------------------------------------------------------
ALTER TABLE "AuditLog" ADD COLUMN     "payloadHash" TEXT,
ADD COLUMN     "subjectHash" TEXT;

-- ---------------------------------------------------------------------------
-- AlterTable: Membership
-- ---------------------------------------------------------------------------
ALTER TABLE "Membership" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "invitedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- AlterTable: Session
-- ---------------------------------------------------------------------------
ALTER TABLE "Session" ADD COLUMN     "ipHash" TEXT;

-- ---------------------------------------------------------------------------
-- AlterTable: customers
-- ---------------------------------------------------------------------------
ALTER TABLE "customers" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- AlterTable: invoices
-- ---------------------------------------------------------------------------
ALTER TABLE "invoices" ADD COLUMN     "fechaAutorizacion" TIMESTAMP(3),
ADD COLUMN     "numeroAutorizacion" TEXT,
ADD COLUMN     "replacesInvoiceId" CHAR(26),
ADD COLUMN     "sriDocumentId" CHAR(26);

-- ---------------------------------------------------------------------------
-- CreateIndex
-- ---------------------------------------------------------------------------
CREATE INDEX "AuditLog_subjectHash_createdAt_idx" ON "AuditLog"("subjectHash", "createdAt");

CREATE INDEX "customers_companyId_isActive_idx" ON "customers"("companyId", "isActive");

CREATE INDEX "invoices_companyId_replacesInvoiceId_idx" ON "invoices"("companyId", "replacesInvoiceId");

CREATE INDEX "invoices_companyId_sriDocumentId_idx" ON "invoices"("companyId", "sriDocumentId");

-- ---------------------------------------------------------------------------
-- AddForeignKey
-- ---------------------------------------------------------------------------
ALTER TABLE "BurnedSecuencial" ADD CONSTRAINT "BurnedSecuencial_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SriDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_replacesInvoiceId_fkey" FOREIGN KEY ("replacesInvoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: Membership.acceptedAt
-- ---------------------------------------------------------------------------
-- Existing memberships pre-date the invitation lifecycle. They were created
-- directly (seed/OWNER bootstrap) and are implicitly active, so we set
-- acceptedAt = createdAt. requireTenant filters on acceptedAt IS NOT NULL,
-- so without this backfill every active operator would lose access after
-- the deploy. Idempotent — the WHERE clause skips rows that already have
-- a non-null acceptedAt (e.g. on a `migrate deploy` rerun).
-- ---------------------------------------------------------------------------
UPDATE "Membership" SET "acceptedAt" = "createdAt" WHERE "acceptedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Backfill: customers.isActive
-- ---------------------------------------------------------------------------
-- The column was added NOT NULL DEFAULT true, so all existing rows already
-- carry true. The explicit UPDATE is a no-op on first apply but defends
-- against any future migration that re-introduces a NULL value (e.g. a
-- failed partial migration where rows were inserted before the default
-- was attached). Idempotent.
-- ---------------------------------------------------------------------------
UPDATE "customers" SET "isActive" = true WHERE "isActive" IS NULL;

COMMIT;

-- =============================================================================
-- Reversibility (manual — Prisma does not generate down-migrations)
-- -----------------------------------------------------------------------------
-- BEGIN;
--   ALTER TABLE "invoices" DROP CONSTRAINT "invoices_replacesInvoiceId_fkey";
--   ALTER TABLE "BurnedSecuencial" DROP CONSTRAINT "BurnedSecuencial_documentId_fkey";
--   DROP INDEX "invoices_companyId_sriDocumentId_idx";
--   DROP INDEX "invoices_companyId_replacesInvoiceId_idx";
--   DROP INDEX "customers_companyId_isActive_idx";
--   DROP INDEX "AuditLog_subjectHash_createdAt_idx";
--   ALTER TABLE "invoices" DROP COLUMN "sriDocumentId",
--                         DROP COLUMN "replacesInvoiceId",
--                         DROP COLUMN "numeroAutorizacion",
--                         DROP COLUMN "fechaAutorizacion";
--   ALTER TABLE "customers" DROP COLUMN "isActive";
--   ALTER TABLE "Session" DROP COLUMN "ipHash";
--   ALTER TABLE "Membership" DROP COLUMN "acceptedAt", DROP COLUMN "invitedAt";
--   ALTER TABLE "AuditLog" DROP COLUMN "payloadHash", DROP COLUMN "subjectHash";
-- COMMIT;
-- =============================================================================
