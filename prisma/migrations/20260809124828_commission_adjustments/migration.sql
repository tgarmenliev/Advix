-- CreateEnum
CREATE TYPE "CommissionAdjustmentType" AS ENUM ('CLAWBACK', 'CORRECTION', 'MANUAL_TOP_UP');

-- CreateTable
CREATE TABLE "CommissionAdjustment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bankId" TEXT NOT NULL,
    "loanApplicationId" TEXT,
    "type" "CommissionAdjustmentType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "CommissionAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionAdjustment_bankId_idx" ON "CommissionAdjustment"("bankId");

-- CreateIndex
CREATE INDEX "CommissionAdjustment_loanApplicationId_idx" ON "CommissionAdjustment"("loanApplicationId");

-- AddForeignKey
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
