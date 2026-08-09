-- CreateEnum
CREATE TYPE "PartnerCommissionModel" AS ENUM ('FIXED', 'PERCENT_OF_LOAN', 'PERCENT_OF_COMMISSION');

-- AlterEnum
BEGIN;
CREATE TYPE "PartnerCommissionStatus_new" AS ENUM ('PROPOSED', 'APPROVED', 'PAID', 'REJECTED');
ALTER TABLE "CommissionRecord" ALTER COLUMN "partnerCommissionStatus" TYPE "PartnerCommissionStatus_new" USING ("partnerCommissionStatus"::text::"PartnerCommissionStatus_new");
ALTER TYPE "PartnerCommissionStatus" RENAME TO "PartnerCommissionStatus_old";
ALTER TYPE "PartnerCommissionStatus_new" RENAME TO "PartnerCommissionStatus";
DROP TYPE "public"."PartnerCommissionStatus_old";
COMMIT;

-- AlterTable
ALTER TABLE "CommissionRecord" ADD COLUMN     "partnerCommissionAmount" INTEGER,
ADD COLUMN     "partnerCommissionApprovedAt" TIMESTAMP(3),
ADD COLUMN     "partnerCommissionApprovedById" TEXT,
ADD COLUMN     "partnerCommissionModel" "PartnerCommissionModel",
ADD COLUMN     "partnerCommissionProposedById" TEXT,
ADD COLUMN     "partnerId" TEXT,
ALTER COLUMN "partnerCommissionPercent" SET DATA TYPE DOUBLE PRECISION;

