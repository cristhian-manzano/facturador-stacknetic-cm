-- CreateEnum
CREATE TYPE "InvoiceEstado" AS ENUM ('BORRADOR', 'EMITIDO', 'ANULADO');

-- CreateTable
CREATE TABLE "invoices" (
    "id" CHAR(26) NOT NULL,
    "companyId" CHAR(26) NOT NULL,
    "customerId" CHAR(26) NOT NULL,
    "emissionPointId" CHAR(26) NOT NULL,
    "estado" "InvoiceEstado" NOT NULL DEFAULT 'BORRADOR',
    "codDoc" TEXT NOT NULL DEFAULT '01',
    "estab" TEXT NOT NULL,
    "ptoEmi" TEXT NOT NULL,
    "secuencial" TEXT,
    "claveAcceso" TEXT,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "fechaEmisionLocal" TEXT NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'DOLAR',
    "ambiente" TEXT NOT NULL,
    "tipoEmision" TEXT NOT NULL DEFAULT '1',
    "obligadoContabilidad" BOOLEAN NOT NULL DEFAULT false,
    "contribuyenteEspecial" TEXT,
    "totalSinImpuestos" DECIMAL(14,2) NOT NULL,
    "totalDescuento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalsJson" JSONB NOT NULL,
    "propina" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importeTotal" DECIMAL(14,2) NOT NULL,
    "sriEstado" "SriEstado",
    "emittedAt" TIMESTAMP(3),
    "mensajesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" CHAR(26) NOT NULL,
    "invoiceId" CHAR(26) NOT NULL,
    "orden" INTEGER NOT NULL,
    "codigoPrincipal" TEXT,
    "codigoAuxiliar" TEXT,
    "descripcion" TEXT NOT NULL,
    "unidadMedida" TEXT,
    "cantidad" DECIMAL(18,6) NOT NULL,
    "precioUnitario" DECIMAL(18,6) NOT NULL,
    "descuento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "precioTotalSinImpuesto" DECIMAL(14,2) NOT NULL,
    "impuestosJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" CHAR(26) NOT NULL,
    "invoiceId" CHAR(26) NOT NULL,
    "orden" INTEGER NOT NULL,
    "formaPago" TEXT NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "plazo" DECIMAL(14,2),
    "unidadTiempo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_adicionales" (
    "id" CHAR(26) NOT NULL,
    "invoiceId" CHAR(26) NOT NULL,
    "orden" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_adicionales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_claveAcceso_key" ON "invoices"("claveAcceso");

-- CreateIndex
CREATE INDEX "invoices_companyId_createdAt_idx" ON "invoices"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_companyId_estado_createdAt_idx" ON "invoices"("companyId", "estado", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_companyId_fechaEmision_idx" ON "invoices"("companyId", "fechaEmision");

-- CreateIndex
CREATE INDEX "invoices_companyId_claveAcceso_idx" ON "invoices"("companyId", "claveAcceso");

-- CreateIndex
CREATE INDEX "invoices_companyId_deletedAt_idx" ON "invoices"("companyId", "deletedAt");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_orden_idx" ON "invoice_lines"("invoiceId", "orden");

-- CreateIndex
CREATE INDEX "invoice_payments_invoiceId_orden_idx" ON "invoice_payments"("invoiceId", "orden");

-- CreateIndex
CREATE INDEX "invoice_adicionales_invoiceId_orden_idx" ON "invoice_adicionales"("invoiceId", "orden");

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_adicionales" ADD CONSTRAINT "invoice_adicionales_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
