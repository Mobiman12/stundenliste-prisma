CREATE TABLE IF NOT EXISTS "VacationLock" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "branchId" INTEGER,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "reason" TEXT,
  "createdByAdminId" INTEGER,
  "isActive" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VacationLock_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "VacationLock_tenantId_isActive_idx"
  ON "VacationLock"("tenantId", "isActive");

CREATE INDEX IF NOT EXISTS "VacationLock_tenantId_branchId_startDate_endDate_idx"
  ON "VacationLock"("tenantId", "branchId", "startDate", "endDate");
