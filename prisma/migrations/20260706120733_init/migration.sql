-- CreateEnum
CREATE TYPE "LoanType" AS ENUM ('CONSUMER', 'MORTGAGE_NO_PURCHASE', 'MORTGAGE_WITH_PURCHASE', 'BUSINESS');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('NEW', 'COLLECTING_INFO', 'WAITING_CLIENT', 'INTERNAL_PROCESSING', 'READY_FOR_BANK', 'SENT_TO_BANKS', 'OFFERS_RECEIVED', 'OFFER_SELECTED', 'APPLICATION_SUBMITTED', 'APPROVED', 'REJECTED_BY_BANK', 'REJECTED_BY_CLIENT', 'DISBURSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('PERMANENT', 'FIXED_TERM');

-- CreateEnum
CREATE TYPE "RelatedPersonRole" AS ENUM ('SPOUSE', 'COHABITANT', 'CO_BORROWER');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'HOUSE', 'SHOP', 'OTHER');

-- CreateEnum
CREATE TYPE "ConstructionType" AS ENUM ('BRICK', 'EPK', 'PANEL', 'OTHER');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('SENT', 'REPLIED_NO_OFFER', 'WAITING_OUR_RESPONSE', 'OFFER_RECEIVED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'SELECTED', 'REJECTED', 'APPLICATION_SUBMITTED', 'APPROVED', 'DISBURSED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('EXPECTED', 'ACCRUED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "PartnerCommissionStatus" AS ENUM ('PENDING', 'PAID');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('GDPR_DECLARATION', 'ID_CARD', 'BUSINESS_ANNUAL_REPORT', 'BUSINESS_TAX_DECLARATION', 'BUSINESS_INTERIM_REPORT', 'BUSINESS_DESCRIPTION', 'BUSINESS_LOAN_PURPOSE', 'OTHER');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'CONSULTANT', 'PARTNER_A', 'PARTNER_B', 'PARTNER_C', 'CLIENT');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'LOGIN', 'DOCUMENT_UPLOAD', 'INQUIRY_SENT', 'OFFER_RECEIVED', 'OFFER_SELECTED', 'COMMISSION_UPDATE');

-- CreateEnum
CREATE TYPE "SecureLinkPurpose" AS ENUM ('CLIENT_DATA_FILL', 'OFFER_REVIEW', 'DOCUMENT_UPLOAD', 'GDPR_CONSENT');

-- CreateEnum
CREATE TYPE "SecureLinkStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schemaName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "commissionPercent" INTEGER,
    "commissionFixed" INTEGER,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "egn" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "employer" TEXT,
    "jobTitle" TEXT,
    "contractType" "ContractType",
    "netSalary" INTEGER,
    "canProvideIncomeProof" BOOLEAN NOT NULL DEFAULT false,
    "canTransferSalary" BOOLEAN NOT NULL DEFAULT false,
    "existingLoansTotal" INTEGER,
    "existingLoansMonthlyTotal" INTEGER,
    "gdprConsentAt" TIMESTAMP(3),
    "gdprDocumentId" TEXT,
    "familySize" INTEGER,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "role" "RelatedPersonRole" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "egn" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "employer" TEXT,
    "jobTitle" TEXT,
    "contractType" "ContractType",
    "netSalary" INTEGER,
    "existingLoansTotal" DOUBLE PRECISION,
    "existingLoansMonthlyTotal" DOUBLE PRECISION,
    "gdprConsentAt" TIMESTAMP(3),
    "gdprDocumentId" TEXT,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanApplicationFamilyMember" (
    "loanApplicationId" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanApplicationFamilyMember_pkey" PRIMARY KEY ("loanApplicationId","familyMemberId")
);

-- CreateTable
CREATE TABLE "LoanApplication" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "partnerId" TEXT,
    "loanType" "LoanType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "purpose" TEXT,
    "status" "LoanStatus" NOT NULL DEFAULT 'NEW',
    "internalNotes" TEXT,

    CONSTRAINT "LoanApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanStatusHistory" (
    "id" TEXT NOT NULL,
    "loanApplicationId" TEXT NOT NULL,
    "fromStatus" "LoanStatus",
    "toStatus" "LoanStatus" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "LoanStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "constructionType" "ConstructionType",
    "yearBuilt" INTEGER,
    "areaSquareMeters" DOUBLE PRECISION,
    "city" TEXT,
    "neighborhood" TEXT,
    "streetNumber" TEXT,
    "floorNumber" INTEGER,
    "totalFloors" INTEGER,
    "additionalDetails" TEXT,
    "owners" TEXT,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanApplicationProperty" (
    "id" TEXT NOT NULL,
    "loanApplicationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "mortgageBankId" TEXT,
    "marketValue" DOUBLE PRECISION,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanApplicationProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bank" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "contractNotes" TEXT,
    "commissionNotes" TEXT,
    "bonusNotes" TEXT,

    CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankOffice" (
    "id" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "city" TEXT NOT NULL,

    CONSTRAINT "BankOffice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankContact" (
    "id" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,

    CONSTRAINT "BankContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryTemplate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InquiryTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankInquiry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "loanApplicationId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "bankContactId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentContent" TEXT,
    "consultantNote" TEXT,
    "status" "InquiryStatus" NOT NULL DEFAULT 'SENT',

    CONSTRAINT "BankInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankOffer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "loanApplicationId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "inquiryId" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "totalRepayment" INTEGER,
    "propertyInsurance" INTEGER,
    "lifeInsurance" INTEGER,
    "propertyValuation" INTEGER,
    "preDisburseeFee" INTEGER,
    "mortgageSetupFee" INTEGER,
    "accountMaintenanceFee" INTEGER,
    "creditCardIssueFee" INTEGER,
    "creditCardMaintenanceFee" INTEGER,
    "monthlyPayment" INTEGER,
    "interestRate" DOUBLE PRECISION,
    "apr" DOUBLE PRECISION,
    "termMonths" INTEGER,
    "totalPayment" INTEGER,
    "additionalConditions" TEXT,
    "comments" TEXT,

    CONSTRAINT "BankOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disbursement" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "trancheNumber" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "disbursedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Disbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRecord" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "loanApplicationId" TEXT NOT NULL,
    "netRevenue" INTEGER,
    "partnerCommissionPercent" INTEGER,
    "partnerCommissionFixed" INTEGER,
    "partnerCommissionPaidAt" TIMESTAMP(3),
    "partnerCommissionStatus" "PartnerCommissionStatus",

    CONSTRAINT "CommissionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrancheCommission" (
    "id" TEXT NOT NULL,
    "disbursementId" TEXT NOT NULL,
    "commissionRecordId" TEXT NOT NULL,
    "expectedAmount" INTEGER,
    "actualAmount" INTEGER,
    "occurredAt" TIMESTAMP(3),
    "status" "CommissionStatus" NOT NULL DEFAULT 'EXPECTED',

    CONSTRAINT "TrancheCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "loanApplicationId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "businessActivity" TEXT,
    "owners" TEXT,
    "loanPurposeDetail" TEXT,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentType" "DocumentType" NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "clientId" TEXT,
    "loanApplicationId" TEXT,
    "uploadedByUserId" TEXT NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecureLink" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "loanApplicationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "clientId" TEXT,
    "familyMemberId" TEXT,
    "purpose" "SecureLinkPurpose" NOT NULL,
    "status" "SecureLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "SecureLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "loanApplicationId" TEXT,
    "oldState" JSONB,
    "metadata" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_schemaName_key" ON "Tenant"("schemaName");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_egn_key" ON "Client"("egn");

-- CreateIndex
CREATE INDEX "Client_egn_idx" ON "Client"("egn");

-- CreateIndex
CREATE INDEX "FamilyMember_clientId_idx" ON "FamilyMember"("clientId");

-- CreateIndex
CREATE INDEX "FamilyMember_egn_idx" ON "FamilyMember"("egn");

-- CreateIndex
CREATE INDEX "LoanApplication_clientId_idx" ON "LoanApplication"("clientId");

-- CreateIndex
CREATE INDEX "LoanApplication_consultantId_idx" ON "LoanApplication"("consultantId");

-- CreateIndex
CREATE INDEX "LoanApplication_status_idx" ON "LoanApplication"("status");

-- CreateIndex
CREATE INDEX "LoanStatusHistory_loanApplicationId_idx" ON "LoanStatusHistory"("loanApplicationId");

-- CreateIndex
CREATE INDEX "LoanApplicationProperty_loanApplicationId_idx" ON "LoanApplicationProperty"("loanApplicationId");

-- CreateIndex
CREATE INDEX "LoanApplicationProperty_propertyId_idx" ON "LoanApplicationProperty"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanApplicationProperty_loanApplicationId_propertyId_key" ON "LoanApplicationProperty"("loanApplicationId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Bank_name_key" ON "Bank"("name");

-- CreateIndex
CREATE INDEX "BankOffice_bankId_idx" ON "BankOffice"("bankId");

-- CreateIndex
CREATE INDEX "BankContact_bankId_idx" ON "BankContact"("bankId");

-- CreateIndex
CREATE INDEX "BankInquiry_loanApplicationId_idx" ON "BankInquiry"("loanApplicationId");

-- CreateIndex
CREATE INDEX "BankInquiry_bankId_idx" ON "BankInquiry"("bankId");

-- CreateIndex
CREATE UNIQUE INDEX "BankOffer_inquiryId_key" ON "BankOffer"("inquiryId");

-- CreateIndex
CREATE INDEX "BankOffer_loanApplicationId_idx" ON "BankOffer"("loanApplicationId");

-- CreateIndex
CREATE INDEX "BankOffer_bankId_idx" ON "BankOffer"("bankId");

-- CreateIndex
CREATE INDEX "Disbursement_offerId_idx" ON "Disbursement"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRecord_loanApplicationId_key" ON "CommissionRecord"("loanApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX "TrancheCommission_disbursementId_key" ON "TrancheCommission"("disbursementId");

-- CreateIndex
CREATE INDEX "TrancheCommission_commissionRecordId_idx" ON "TrancheCommission"("commissionRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_loanApplicationId_key" ON "BusinessProfile"("loanApplicationId");

-- CreateIndex
CREATE INDEX "Document_clientId_idx" ON "Document"("clientId");

-- CreateIndex
CREATE INDEX "Document_loanApplicationId_idx" ON "Document"("loanApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX "SecureLink_token_key" ON "SecureLink"("token");

-- CreateIndex
CREATE INDEX "SecureLink_token_idx" ON "SecureLink"("token");

-- CreateIndex
CREATE INDEX "SecureLink_loanApplicationId_idx" ON "SecureLink"("loanApplicationId");

-- CreateIndex
CREATE INDEX "SecureLink_clientId_idx" ON "SecureLink"("clientId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_loanApplicationId_idx" ON "AuditLog"("loanApplicationId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplicationFamilyMember" ADD CONSTRAINT "LoanApplicationFamilyMember_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplicationFamilyMember" ADD CONSTRAINT "LoanApplicationFamilyMember_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanStatusHistory" ADD CONSTRAINT "LoanStatusHistory_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplicationProperty" ADD CONSTRAINT "LoanApplicationProperty_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplicationProperty" ADD CONSTRAINT "LoanApplicationProperty_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplicationProperty" ADD CONSTRAINT "LoanApplicationProperty_mortgageBankId_fkey" FOREIGN KEY ("mortgageBankId") REFERENCES "Bank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankOffice" ADD CONSTRAINT "BankOffice_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankContact" ADD CONSTRAINT "BankContact_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankInquiry" ADD CONSTRAINT "BankInquiry_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankInquiry" ADD CONSTRAINT "BankInquiry_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankInquiry" ADD CONSTRAINT "BankInquiry_bankContactId_fkey" FOREIGN KEY ("bankContactId") REFERENCES "BankContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankOffer" ADD CONSTRAINT "BankOffer_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankOffer" ADD CONSTRAINT "BankOffer_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankOffer" ADD CONSTRAINT "BankOffer_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "BankInquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "BankOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrancheCommission" ADD CONSTRAINT "TrancheCommission_disbursementId_fkey" FOREIGN KEY ("disbursementId") REFERENCES "Disbursement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrancheCommission" ADD CONSTRAINT "TrancheCommission_commissionRecordId_fkey" FOREIGN KEY ("commissionRecordId") REFERENCES "CommissionRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecureLink" ADD CONSTRAINT "SecureLink_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecureLink" ADD CONSTRAINT "SecureLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecureLink" ADD CONSTRAINT "SecureLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecureLink" ADD CONSTRAINT "SecureLink_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
