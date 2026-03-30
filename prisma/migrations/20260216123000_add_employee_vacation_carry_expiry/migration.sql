-- Add optional vacation carry-over expiry configuration per employee.
-- If enabled and a date is set, leftover carry from the previous year lapses on that date.

ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "vacationCarryExpiryEnabled" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "vacationCarryExpiryDate" TEXT;
