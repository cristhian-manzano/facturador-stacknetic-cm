-- CreateTable
CREATE TABLE "customers" (
    "id" CHAR(26) NOT NULL,
    "companyId" CHAR(26) NOT NULL,
    "tipoIdentificacion" TEXT NOT NULL,
    "identificacion" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "nombreComercial" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_companyId_razonSocial_idx" ON "customers"("companyId", "razonSocial");

-- CreateIndex
CREATE INDEX "customers_companyId_identificacion_idx" ON "customers"("companyId", "identificacion");

-- CreateIndex
CREATE INDEX "customers_companyId_deletedAt_idx" ON "customers"("companyId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_companyId_tipoIdentificacion_identificacion_key" ON "customers"("companyId", "tipoIdentificacion", "identificacion");
