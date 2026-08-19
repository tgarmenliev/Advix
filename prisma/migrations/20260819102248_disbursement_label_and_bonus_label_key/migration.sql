-- DropIndex
DROP INDEX "BankPeriodBonus_bankId_loanCategory_periodType_periodYear_p_key";

-- AlterTable
ALTER TABLE "BankPeriodBonus" ADD COLUMN     "label" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Disbursement" ADD COLUMN     "commissionLabel" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BankPeriodBonus_bankId_loanCategory_periodType_periodYear_p_key" ON "BankPeriodBonus"("bankId", "loanCategory", "periodType", "periodYear", "periodIndex", "label");

