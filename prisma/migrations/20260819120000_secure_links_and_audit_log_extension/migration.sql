-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropIndex
DROP INDEX "SecureLink_token_idx";

-- DropIndex
DROP INDEX "SecureLink_token_key";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "secureLinkId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SecureLink" DROP COLUMN "token",
ADD COLUMN     "tokenHash" TEXT NOT NULL,
ALTER COLUMN "purpose" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SecureLinkIndex" (
    "tokenHash" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecureLinkIndex_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "AuditLog_secureLinkId_idx" ON "AuditLog"("secureLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "SecureLink_tokenHash_key" ON "SecureLink"("tokenHash");

-- CreateIndex
CREATE INDEX "SecureLink_familyMemberId_idx" ON "SecureLink"("familyMemberId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_secureLinkId_fkey" FOREIGN KEY ("secureLinkId") REFERENCES "SecureLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

