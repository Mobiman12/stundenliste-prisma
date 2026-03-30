ALTER TABLE "Employee"
  ADD COLUMN "openingType" TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN "openingValuesLocked" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "openingEffectiveDate" TEXT,
  ADD COLUMN "openingOvertimeBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "openingVacationCarryDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "openingVacationTakenYtd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "openingBonusCarry" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Bestandswerte aus den bisherigen Importfeldern einmalig übernehmen
UPDATE "Employee"
SET
  "openingType" = CASE
    WHEN COALESCE("importedOvertimeBalance", 0) <> 0
      OR COALESCE("importedMinusstundenBalance", 0) <> 0
      OR COALESCE("importedVacationTaken", 0) <> 0
      OR COALESCE("importedBonusEarned", 0) <> 0
      OR COALESCE("vacationDaysLastYear", 0) <> 0
    THEN 'existing'
    ELSE 'new'
  END,
  "openingOvertimeBalance" = COALESCE("importedOvertimeBalance", 0) - COALESCE("importedMinusstundenBalance", 0),
  "openingVacationCarryDays" = COALESCE("vacationDaysLastYear", 0),
  "openingBonusCarry" = COALESCE("importedBonusEarned", 0),
  "openingEffectiveDate" = COALESCE("entryDate", CURRENT_DATE::text)
WHERE COALESCE("openingEffectiveDate", '') = '';
