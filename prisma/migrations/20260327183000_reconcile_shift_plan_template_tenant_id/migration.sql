DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ShiftPlanTemplate'
      AND column_name = 'tenantId'
  ) THEN
    ALTER TABLE "ShiftPlanTemplate" ADD COLUMN "tenantId" TEXT;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ShiftPlanTemplate"
    WHERE "tenantId" IS NULL OR btrim("tenantId") = ''
  ) THEN
    RAISE EXCEPTION 'ShiftPlanTemplate.tenantId contains NULL or blank values; manual reconciliation required before enforcing NOT NULL';
  END IF;
END
$$;

ALTER TABLE "ShiftPlanTemplate"
  ALTER COLUMN "tenantId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "ShiftPlanTemplate_tenantId_idx"
  ON "ShiftPlanTemplate"("tenantId");
