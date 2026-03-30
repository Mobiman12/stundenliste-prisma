-- Add separate house number to employee address.
-- Control Plane stores street + houseNumber as distinct fields; Timesheet needs the same
-- to avoid losing the house number when profiles are synced.

ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "houseNumber" TEXT;

CREATE INDEX IF NOT EXISTS "Employee_tenantId_houseNumber_idx"
  ON "Employee"("tenantId", "houseNumber");
