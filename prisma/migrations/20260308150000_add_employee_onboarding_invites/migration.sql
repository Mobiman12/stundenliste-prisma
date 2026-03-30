-- Add pending-onboarding metadata to employees
ALTER TABLE "Employee"
  ADD COLUMN "onboardingStatus" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "onboardingSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "profilePhotoFileName" TEXT;

-- One-time onboarding invitations
CREATE TABLE "EmployeeOnboardingInvite" (
  "id" SERIAL NOT NULL,
  "tenantId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "message" TEXT,
  "createdByAdminId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "employeeId" INTEGER,
  "signatureName" TEXT,
  "signatureAcceptedAt" TIMESTAMP(3),
  "submissionIp" TEXT,
  "submissionUserAgent" TEXT,
  "payloadJson" TEXT,
  CONSTRAINT "EmployeeOnboardingInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeOnboardingInvite_tokenHash_key" ON "EmployeeOnboardingInvite"("tokenHash");
CREATE INDEX "EmployeeOnboardingInvite_tenantId_idx" ON "EmployeeOnboardingInvite"("tenantId");
CREATE INDEX "EmployeeOnboardingInvite_tenantId_email_idx" ON "EmployeeOnboardingInvite"("tenantId", "email");
CREATE INDEX "EmployeeOnboardingInvite_tenantId_createdAt_idx" ON "EmployeeOnboardingInvite"("tenantId", "createdAt");
CREATE INDEX "EmployeeOnboardingInvite_tenantId_expiresAt_idx" ON "EmployeeOnboardingInvite"("tenantId", "expiresAt");
CREATE INDEX "EmployeeOnboardingInvite_tenantId_usedAt_idx" ON "EmployeeOnboardingInvite"("tenantId", "usedAt");

ALTER TABLE "EmployeeOnboardingInvite"
  ADD CONSTRAINT "EmployeeOnboardingInvite_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
