ALTER TABLE "ShiftPlanTemplate"
  ADD COLUMN IF NOT EXISTS "employeeId" INTEGER;

CREATE INDEX IF NOT EXISTS "ShiftPlanTemplate_employeeId_idx"
  ON "ShiftPlanTemplate"("employeeId");

CREATE INDEX IF NOT EXISTS "ShiftPlanTemplate_tenantId_employeeId_idx"
  ON "ShiftPlanTemplate"("tenantId", "employeeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ShiftPlanTemplate_employeeId_fkey'
  ) THEN
    ALTER TABLE "ShiftPlanTemplate"
      ADD CONSTRAINT "ShiftPlanTemplate_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
