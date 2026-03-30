CREATE TABLE "EmployeeOvertimeAdjustment" (
  "id" SERIAL NOT NULL,
  "tenantId" TEXT NOT NULL,
  "employeeId" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "deltaHours" DOUBLE PRECISION NOT NULL,
  "balanceBefore" DOUBLE PRECISION NOT NULL,
  "balanceAfter" DOUBLE PRECISION NOT NULL,
  "correctionBefore" DOUBLE PRECISION NOT NULL,
  "correctionAfter" DOUBLE PRECISION NOT NULL,
  "createdByAdminId" INTEGER,
  "createdByAdminName" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeOvertimeAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeOvertimeAdjustment_tenantId_employeeId_createdAt_idx"
  ON "EmployeeOvertimeAdjustment"("tenantId", "employeeId", "createdAt");

CREATE INDEX "EmployeeOvertimeAdjustment_employeeId_year_month_createdAt_idx"
  ON "EmployeeOvertimeAdjustment"("employeeId", "year", "month", "createdAt");

ALTER TABLE "EmployeeOvertimeAdjustment"
  ADD CONSTRAINT "EmployeeOvertimeAdjustment_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
