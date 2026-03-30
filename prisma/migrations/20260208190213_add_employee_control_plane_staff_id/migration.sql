-- Add Control Plane Staff ID mapping to Timesheet employees.
-- This allows us to link central StaffMember.id to legacy employees without overwriting the real personnel number.

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "controlPlaneStaffId" TEXT;

-- Unique per tenant (multiple NULLs are allowed).
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_tenantId_controlPlaneStaffId_key"
  ON "Employee"("tenantId", "controlPlaneStaffId");

CREATE INDEX IF NOT EXISTS "Employee_tenantId_controlPlaneStaffId_idx"
  ON "Employee"("tenantId", "controlPlaneStaffId");
