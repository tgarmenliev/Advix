/*
  Warnings:

  - Made the column `city` on table `BankContact` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "BankContact" ALTER COLUMN "city" SET NOT NULL;
