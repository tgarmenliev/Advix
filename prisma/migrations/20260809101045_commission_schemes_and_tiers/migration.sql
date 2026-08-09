-- CreateEnum
CREATE TYPE "CommissionSchemeType" AS ENUM ('COMMISSION', 'BONUS');

-- CreateEnum
CREATE TYPE "CommissionLoanCategory" AS ENUM ('MORTGAGE', 'CONSUMER');

-- CreateEnum
CREATE TYPE "CommissionPeriodType" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "CommissionEvaluationMode" AS ENUM ('PROGRESSIVE_RETROACTIVE', 'END_OF_PERIOD');

-- CreateEnum
CREATE TYPE "CommissionBasis" AS ENUM ('FLAT_PERCENT', 'VOLUME_TIERED');

-- CreateTable
CREATE TABLE "CommissionScheme" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bankId" TEXT NOT NULL,
    "schemeType" "CommissionSchemeType" NOT NULL,
    "loanCategory" "CommissionLoanCategory" NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "basis" "CommissionBasis" NOT NULL DEFAULT 'FLAT_PERCENT',
    "flatPercent" DOUBLE PRECISION,
    "periodType" "CommissionPeriodType",
    "evaluationMode" "CommissionEvaluationMode",
    "maxPerDealAmount" INTEGER,
    "notes" TEXT,

    CONSTRAINT "CommissionScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionTier" (
    "id" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "minVolume" INTEGER NOT NULL,
    "maxVolume" INTEGER,
    "percent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "CommissionTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionScheme_bankId_idx" ON "CommissionScheme"("bankId");

-- CreateIndex
CREATE INDEX "CommissionScheme_bankId_schemeType_loanCategory_idx" ON "CommissionScheme"("bankId", "schemeType", "loanCategory");

-- CreateIndex
CREATE INDEX "CommissionTier_schemeId_idx" ON "CommissionTier"("schemeId");

-- AddForeignKey
ALTER TABLE "CommissionScheme" ADD CONSTRAINT "CommissionScheme_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionTier" ADD CONSTRAINT "CommissionTier_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "CommissionScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
