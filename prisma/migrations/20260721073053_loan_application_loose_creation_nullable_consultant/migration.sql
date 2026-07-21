-- DropForeignKey
ALTER TABLE "LoanApplication" DROP CONSTRAINT "LoanApplication_consultantId_fkey";

-- AlterTable
ALTER TABLE "LoanApplication" ALTER COLUMN "consultantId" DROP NOT NULL,
ALTER COLUMN "termMonths" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
