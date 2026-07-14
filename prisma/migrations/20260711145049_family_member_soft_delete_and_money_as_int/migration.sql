/*
  Warnings:

  - You are about to alter the column `existingLoansTotal` on the `FamilyMember` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - You are about to alter the column `existingLoansMonthlyTotal` on the `FamilyMember` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - You are about to alter the column `marketValue` on the `LoanApplicationProperty` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.

*/
-- AlterTable
ALTER TABLE "FamilyMember" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "existingLoansTotal" SET DATA TYPE INTEGER,
ALTER COLUMN "existingLoansMonthlyTotal" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "LoanApplicationProperty" ALTER COLUMN "marketValue" SET DATA TYPE INTEGER;
