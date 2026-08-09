-- CreateTable
CREATE TABLE "BankPeriodBonus" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bankId" TEXT NOT NULL,
    "loanCategory" "CommissionLoanCategory" NOT NULL,
    "periodType" "CommissionPeriodType" NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodIndex" INTEGER NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "volume" INTEGER NOT NULL,
    "appliedPercent" DOUBLE PRECISION NOT NULL,
    "expectedAmount" INTEGER NOT NULL,
    "actualAmount" INTEGER,
    "occurredAt" TIMESTAMP(3),
    "status" "CommissionStatus" NOT NULL DEFAULT 'EXPECTED',

    CONSTRAINT "BankPeriodBonus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankPeriodBonus_bankId_idx" ON "BankPeriodBonus"("bankId");

-- CreateIndex
CREATE UNIQUE INDEX "BankPeriodBonus_bankId_loanCategory_periodType_periodYear_p_key" ON "BankPeriodBonus"("bankId", "loanCategory", "periodType", "periodYear", "periodIndex");

-- AddForeignKey
ALTER TABLE "BankPeriodBonus" ADD CONSTRAINT "BankPeriodBonus_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
