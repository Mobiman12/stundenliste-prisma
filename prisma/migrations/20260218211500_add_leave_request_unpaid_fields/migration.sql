ALTER TABLE "LeaveRequest"
  ADD COLUMN IF NOT EXISTS "isUnpaid" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "unpaidDays" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "LeaveRequest_isUnpaid_createdAt_idx"
  ON "LeaveRequest"("isUnpaid", "createdAt");
