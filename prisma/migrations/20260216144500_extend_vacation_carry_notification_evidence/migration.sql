-- Extend legal evidence for vacation carry reminders.
ALTER TABLE "VacationCarryNotification"
  ADD COLUMN IF NOT EXISTS "fromName" TEXT,
  ADD COLUMN IF NOT EXISTS "subject" TEXT,
  ADD COLUMN IF NOT EXISTS "bodyText" TEXT;
