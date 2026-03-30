-- Add mandatory pause configuration for shifts under 6h.
-- If enabled, Timesheet enforces a pause (minPauseUnder6Minutes) for working times under 6h,
-- starting from a configured threshold (mandatoryPauseMinWorkMinutes).

ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "mandatoryPauseMinWorkMinutes" INTEGER NOT NULL DEFAULT 0;
