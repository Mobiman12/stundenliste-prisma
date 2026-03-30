-- Conservative staging step for weekly fallback migration.
-- Enforce one ShiftPlan row per employee before any SQLite -> PostgreSQL read cutover.
CREATE UNIQUE INDEX IF NOT EXISTS "ShiftPlan_employeeId_key" ON "ShiftPlan"("employeeId");
