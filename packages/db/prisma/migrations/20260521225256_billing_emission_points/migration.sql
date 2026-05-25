-- AlterTable
ALTER TABLE "BurnedSecuencial" ADD COLUMN     "burnedByUserId" CHAR(26),
ADD COLUMN     "reason" TEXT NOT NULL DEFAULT 'reissue',
ADD COLUMN     "tipoComprobante" TEXT NOT NULL DEFAULT '01';

-- CreateTable
CREATE TABLE "establecimientos" (
    "id" CHAR(26) NOT NULL,
    "companyId" CHAR(26) NOT NULL,
    "codigo" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "isMatriz" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "establecimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emission_points" (
    "id" CHAR(26) NOT NULL,
    "companyId" CHAR(26) NOT NULL,
    "establecimientoId" CHAR(26) NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "emission_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secuencial_counters" (
    "companyId" CHAR(26) NOT NULL,
    "estab" TEXT NOT NULL,
    "ptoEmi" TEXT NOT NULL,
    "tipoComprobante" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secuencial_counters_pkey" PRIMARY KEY ("companyId","estab","ptoEmi","tipoComprobante")
);

-- CreateIndex
CREATE INDEX "establecimientos_companyId_deletedAt_idx" ON "establecimientos"("companyId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "establecimientos_companyId_codigo_key" ON "establecimientos"("companyId", "codigo");

-- CreateIndex
CREATE INDEX "emission_points_companyId_deletedAt_idx" ON "emission_points"("companyId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "emission_points_establecimientoId_codigo_key" ON "emission_points"("establecimientoId", "codigo");

-- CreateIndex
CREATE INDEX "BurnedSecuencial_companyId_estab_ptoEmi_tipoComprobante_cre_idx" ON "BurnedSecuencial"("companyId", "estab", "ptoEmi", "tipoComprobante", "createdAt");

-- AddForeignKey
ALTER TABLE "emission_points" ADD CONSTRAINT "emission_points_establecimientoId_fkey" FOREIGN KEY ("establecimientoId") REFERENCES "establecimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
