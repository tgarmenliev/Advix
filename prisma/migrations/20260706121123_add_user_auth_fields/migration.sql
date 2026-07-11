-- AlterTable
ALTER TABLE "User" ADD COLUMN     "refreshTokenHash" TEXT,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;
