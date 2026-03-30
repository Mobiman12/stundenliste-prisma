ALTER TABLE "Employee"
  ADD COLUMN "compensationType" TEXT NOT NULL DEFAULT 'hourly',
  ADD COLUMN "monthlySalaryGross" DOUBLE PRECISION;

UPDATE "Employee"
SET "compensationType" = 'hourly'
WHERE COALESCE("compensationType", '') = '';
