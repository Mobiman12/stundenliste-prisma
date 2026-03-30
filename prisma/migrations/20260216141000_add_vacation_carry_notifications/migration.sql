-- Track one yearly rest-vacation carry reminder per employee (mail channel + delivery evidence).

CREATE TABLE IF NOT EXISTS "VacationCarryNotification" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "employeeId" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "recipient" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "providerMessageId" TEXT,
  "providerResponse" TEXT,
  "errorMessage" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VacationCarryNotification_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VacationCarryNotification_employeeId_year_key" UNIQUE ("employeeId", "year")
);

CREATE INDEX IF NOT EXISTS "VacationCarryNotification_tenantId_employeeId_createdAt_idx"
  ON "VacationCarryNotification"("tenantId", "employeeId", "createdAt");

CREATE INDEX IF NOT EXISTS "VacationCarryNotification_tenantId_year_status_idx"
  ON "VacationCarryNotification"("tenantId", "year", "status");
