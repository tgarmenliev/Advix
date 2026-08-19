-- AlterEnum
ALTER TYPE "CommissionBasis" ADD VALUE 'COUNT_TIERED';

-- AlterEnum
ALTER TYPE "CommissionLoanCategory" ADD VALUE 'BUSINESS';

-- AlterTable
ALTER TABLE "CommissionAdjustment" ADD COLUMN     "bankPeriodBonusId" TEXT;

-- AlterTable
ALTER TABLE "CommissionScheme" ADD COLUMN     "clawbackPolicy" TEXT,
ADD COLUMN     "label" TEXT;

-- AlterTable
ALTER TABLE "CommissionTier" ADD COLUMN     "maxCount" INTEGER,
ADD COLUMN     "minCount" INTEGER,
ALTER COLUMN "minVolume" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "CommissionAdjustment_bankPeriodBonusId_idx" ON "CommissionAdjustment"("bankPeriodBonusId");

-- AddForeignKey
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_bankPeriodBonusId_fkey" FOREIGN KEY ("bankPeriodBonusId") REFERENCES "BankPeriodBonus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
