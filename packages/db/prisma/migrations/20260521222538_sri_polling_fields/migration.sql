-- AlterTable
ALTER TABLE "SriDocument" ADD COLUMN     "lastPollAt" TIMESTAMP(3),
ADD COLUMN     "nextPollAt" TIMESTAMP(3),
ADD COLUMN     "pollAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "SriDocument_estado_nextPollAt_idx" ON "SriDocument"("estado", "nextPollAt");
