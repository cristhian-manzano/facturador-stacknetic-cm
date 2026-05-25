-- CreateEnum
CREATE TYPE "SriEstado" AS ENUM ('PENDIENTE', 'FIRMADO', 'ENVIADO', 'RECIBIDA', 'EN_PROCESO', 'AUTORIZADO', 'NO_AUTORIZADO', 'DEVUELTA', 'ERROR_RED', 'ERROR_BUILD');

-- CreateEnum
CREATE TYPE "SriEtapa" AS ENUM ('BUILD', 'SIGN', 'SEND', 'RECEIVE', 'AUTHORIZE', 'POLL', 'ERROR');

-- CreateTable
CREATE TABLE "Certificate" (
    "id" CHAR(26) NOT NULL,
    "companyId" CHAR(26) NOT NULL,
    "alias" TEXT NOT NULL,
    "subjectCN" TEXT NOT NULL,
    "issuerCN" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "p12CiphertextB64" TEXT NOT NULL,
    "p12NonceB64" TEXT NOT NULL,
    "p12TagB64" TEXT NOT NULL,
    "passphraseCiphertextB64" TEXT,
    "passphraseNonceB64" TEXT,
    "passphraseTagB64" TEXT,
    "kmsKeyVersion" TEXT NOT NULL DEFAULT 'v1',
    "fingerprintSha256" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SriDocument" (
    "id" CHAR(26) NOT NULL,
    "companyId" CHAR(26) NOT NULL,
    "tipoComprobante" TEXT NOT NULL,
    "claveAcceso" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "estab" TEXT NOT NULL,
    "ptoEmi" TEXT NOT NULL,
    "secuencial" TEXT NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "estado" "SriEstado" NOT NULL,
    "numeroAutorizacion" TEXT,
    "fechaAutorizacion" TIMESTAMP(3),
    "signedXmlBlobKey" TEXT,
    "authorizedXmlBlobKey" TEXT,
    "mensajesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SriDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SriEvent" (
    "id" CHAR(26) NOT NULL,
    "documentId" CHAR(26) NOT NULL,
    "etapa" "SriEtapa" NOT NULL,
    "estado" "SriEstado" NOT NULL,
    "mensajesJson" JSONB,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SriEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BurnedSecuencial" (
    "id" CHAR(26) NOT NULL,
    "companyId" CHAR(26) NOT NULL,
    "estab" TEXT NOT NULL,
    "ptoEmi" TEXT NOT NULL,
    "secuencial" TEXT NOT NULL,
    "documentId" CHAR(26),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BurnedSecuencial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_fingerprintSha256_key" ON "Certificate"("fingerprintSha256");

-- CreateIndex
CREATE INDEX "Certificate_companyId_status_idx" ON "Certificate"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_companyId_serialNumber_key" ON "Certificate"("companyId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SriDocument_claveAcceso_key" ON "SriDocument"("claveAcceso");

-- CreateIndex
CREATE INDEX "SriDocument_companyId_estado_createdAt_idx" ON "SriDocument"("companyId", "estado", "createdAt");

-- CreateIndex
CREATE INDEX "SriDocument_companyId_claveAcceso_idx" ON "SriDocument"("companyId", "claveAcceso");

-- CreateIndex
CREATE INDEX "SriEvent_documentId_createdAt_idx" ON "SriEvent"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "BurnedSecuencial_companyId_estab_ptoEmi_idx" ON "BurnedSecuencial"("companyId", "estab", "ptoEmi");

-- CreateIndex
CREATE UNIQUE INDEX "BurnedSecuencial_companyId_estab_ptoEmi_secuencial_key" ON "BurnedSecuencial"("companyId", "estab", "ptoEmi", "secuencial");

-- AddForeignKey
ALTER TABLE "SriEvent" ADD CONSTRAINT "SriEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SriDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
