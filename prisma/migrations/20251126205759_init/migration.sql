-- CreateTable
CREATE TABLE "AdminDocumentSeen" (
    "adminId" INTEGER NOT NULL,
    "lastSeen" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "AdminDocumentSeen_pkey" PRIMARY KEY ("adminId")
);

-- CreateTable
CREATE TABLE "AdminSettings" (
    "userId" TEXT NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AdminSettings_pkey" PRIMARY KEY ("userId","jahr","monat","key")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReminderSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" INTEGER NOT NULL DEFAULT 0,
    "sendHour" INTEGER NOT NULL DEFAULT 18,
    "subject" TEXT NOT NULL DEFAULT 'Erinnerung: Stundenliste vervollständigen',
    "contentTemplate" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ReminderSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderSendLog" (
    "periodKey" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderSendLog_pkey" PRIMARY KEY ("periodKey")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "street" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "openingHours" TEXT,
    "slug" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "country" TEXT NOT NULL DEFAULT 'DE',
    "phone" TEXT,
    "email" TEXT,
    "metadata" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchSchedule" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "segmentIndex" INTEGER NOT NULL DEFAULT 0,
    "startsAtMinutes" INTEGER,
    "endsAtMinutes" INTEGER,
    "isActive" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" SERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "street" TEXT,
    "zipCode" TEXT,
    "city" TEXT,
    "birthDate" TEXT,
    "entryDate" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "personnelNumber" TEXT NOT NULL,
    "arbeitsstundenProWoche" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "taxClass" TEXT,
    "hourlyWage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vacationDays" INTEGER NOT NULL DEFAULT 20,
    "vacationDaysLastYear" INTEGER NOT NULL DEFAULT 0,
    "Rolle" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allowMinusHours" TEXT NOT NULL DEFAULT 'Nein',
    "overtimeBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sachbezuege" TEXT NOT NULL DEFAULT 'Nein',
    "sachbezuegeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mindJahresumsatz" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sachbezugVerpflegung" TEXT NOT NULL DEFAULT 'Nein',
    "maxUeberstunden" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxMinusstunden" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "yearlySollHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importedOvertimeBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importedMinusstundenBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importedVacationTaken" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importedBonusEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importedPlusOvertime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importedMinusOvertime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monatlicherBonusProzent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tillhubUserId" TEXT,
    "tillhubAccountId" TEXT,
    "minPauseUnder6Minutes" INTEGER NOT NULL DEFAULT 0,
    "isActive" INTEGER NOT NULL DEFAULT 1,
    "federalState" TEXT,
    "mandatoryPauseEnabled" INTEGER NOT NULL DEFAULT 0,
    "bookingPin" TEXT NOT NULL DEFAULT '0000',
    "showInCalendar" INTEGER NOT NULL DEFAULT 1,
    "vacationDaysTotal" INTEGER NOT NULL DEFAULT 20,
    "kinderfreibetrag" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "iban" TEXT,
    "bic" TEXT,
    "steuerId" TEXT,
    "socialSecurityNumber" TEXT,
    "healthInsurance" TEXT,
    "nationality" TEXT,
    "maritalStatus" TEXT,
    "healthInsuranceNumber" TEXT,
    "employmentType" TEXT,
    "workTimeModel" TEXT,
    "probationMonths" INTEGER,
    "tarifGroup" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelation" TEXT,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkHours" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "workDate" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "pauseTime" TEXT,
    "notes" TEXT,

    CONSTRAINT "WorkHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyHoursHistory" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "changeDate" TEXT NOT NULL,
    "weeklyHours" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "WeeklyHoursHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoursBank" (
    "employeeId" INTEGER NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "HoursBank_pkey" PRIMARY KEY ("employeeId")
);

-- CreateTable
CREATE TABLE "OvertimeAccount" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "dayDate" TEXT NOT NULL,
    "dailyDiff" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyCarryover" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "OvertimeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SickAccount" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER,
    "dayDate" TEXT,
    "dailySickHours" DOUBLE PRECISION,
    "totalSickBalance" DOUBLE PRECISION,

    CONSTRAINT "SickAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolidayAccount" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER,
    "dayDate" TEXT,
    "holidayUsed" DOUBLE PRECISION,
    "holidayBalance" DOUBLE PRECISION,

    CONSTRAINT "HolidayAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftPlan" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "twoWeekCycle" TEXT NOT NULL DEFAULT 'no',
    "W1_mon_start" TEXT,
    "W1_mon_end" TEXT,
    "W1_tue_start" TEXT,
    "W1_tue_end" TEXT,
    "W1_wed_start" TEXT,
    "W1_wed_end" TEXT,
    "W1_thu_start" TEXT,
    "W1_thu_end" TEXT,
    "W1_fri_start" TEXT,
    "W1_fri_end" TEXT,
    "W1_sat_start" TEXT,
    "W1_sat_end" TEXT,
    "W1_sun_start" TEXT,
    "W1_sun_end" TEXT,
    "W2_mon_start" TEXT,
    "W2_mon_end" TEXT,
    "W2_tue_start" TEXT,
    "W2_tue_end" TEXT,
    "W2_wed_start" TEXT,
    "W2_wed_end" TEXT,
    "W2_thu_start" TEXT,
    "W2_thu_end" TEXT,
    "W2_fri_start" TEXT,
    "W2_fri_end" TEXT,
    "W2_sat_start" TEXT,
    "W2_sat_end" TEXT,
    "W2_sun_start" TEXT,
    "W2_sun_end" TEXT,
    "W1_mon_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W1_tue_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W1_wed_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W1_thu_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W1_fri_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W1_sat_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W1_sun_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W2_mon_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W2_tue_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W2_wed_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W2_thu_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W2_fri_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W2_sat_req_pause_min" INTEGER NOT NULL DEFAULT 0,
    "W2_sun_req_pause_min" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShiftPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FooterViewSettings" (
    "userId" INTEGER NOT NULL,
    "groupStates" TEXT,

    CONSTRAINT "FooterViewSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "BonusMonat" (
    "userId" INTEGER NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "bonusAusbezahlt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonusUebertrag" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "employeeId" INTEGER,

    CONSTRAINT "BonusMonat_pkey" PRIMARY KEY ("userId","jahr","monat")
);

-- CreateTable
CREATE TABLE "BonusAuszahlung" (
    "employeeId" INTEGER NOT NULL,
    "jahr" INTEGER NOT NULL,
    "monat" INTEGER NOT NULL,
    "bonusAusgezahlt" DOUBLE PRECISION,

    CONSTRAINT "BonusAuszahlung_pkey" PRIMARY KEY ("employeeId","jahr","monat")
);

-- CreateTable
CREATE TABLE "EmployeeBonus" (
    "employeeId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "auszahlung" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uebertrag" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonusAusgezahlt" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "EmployeeBonus_pkey" PRIMARY KEY ("employeeId","year","month")
);

-- CreateTable
CREATE TABLE "MonthlyClosing" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "closedAt" TEXT,
    "closedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',

    CONSTRAINT "MonthlyClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "News" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "News_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsRead" (
    "employeeId" INTEGER NOT NULL,
    "newsId" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsRead_pkey" PRIMARY KEY ("employeeId","newsId")
);

-- CreateTable
CREATE TABLE "EmployeeNewsRead" (
    "employeeId" INTEGER NOT NULL,
    "newsId" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeNewsRead_pkey" PRIMARY KEY ("employeeId","newsId")
);

-- CreateTable
CREATE TABLE "DailyDay" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "dayDate" TEXT NOT NULL,
    "brutto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "kommt1" TEXT,
    "geht1" TEXT,
    "kommt2" TEXT,
    "geht2" TEXT,
    "pause" TEXT,
    "code" TEXT,
    "bemerkungen" TEXT,
    "mittag" TEXT,
    "schicht" TEXT DEFAULT '',
    "sickHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "childSickHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shortWorkHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vacationHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overtimeDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holidayHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "planHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "forcedOverflow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "forcedOverflowReal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requiredPauseUnder6Minutes" INTEGER NOT NULL DEFAULT 0,
    "adminLastChangeAt" TEXT,
    "adminLastChangeBy" TEXT,
    "adminLastChangeType" TEXT DEFAULT '',
    "adminLastChangeSummary" TEXT DEFAULT '',

    CONSTRAINT "DailyDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusPayoutRequest" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "requestedAmount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BonusPayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusScheme" (
    "employeeId" INTEGER NOT NULL,
    "schemeType" TEXT NOT NULL DEFAULT 'linear',
    "linearPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "BonusScheme_pkey" PRIMARY KEY ("employeeId")
);

-- CreateTable
CREATE TABLE "BonusTier" (
    "employeeId" INTEGER NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "BonusTier_pkey" PRIMARY KEY ("employeeId","threshold")
);

-- CreateTable
CREATE TABLE "ShiftPlanDay" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "dayDate" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "requiredPauseMinutes" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "branchId" INTEGER,

    CONSTRAINT "ShiftPlanDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftPlanTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftPlanTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftPlanTemplateDay" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "segmentIndex" INTEGER NOT NULL DEFAULT 0,
    "mode" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "requiredPauseMinutes" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftPlanTemplateDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeWeekdayPause" (
    "employeeId" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeWeekdayPause_pkey" PRIMARY KEY ("employeeId","weekday")
);

-- CreateTable
CREATE TABLE "EmployeeOvertimePayout" (
    "employeeId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "payoutHours" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "EmployeeOvertimePayout_pkey" PRIMARY KEY ("employeeId","year","month")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adminNote" TEXT,
    "decidedBy" INTEGER,
    "decidedAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancellationRequested" INTEGER NOT NULL DEFAULT 0,
    "cancellationRequestedAt" TEXT,
    "cancellationNote" TEXT,
    "cancelledAt" TEXT,
    "appliedToShiftPlan" INTEGER NOT NULL DEFAULT 0,
    "startTime" TEXT,
    "endTime" TEXT,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeBranch" (
    "employeeId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeBranch_pkey" PRIMARY KEY ("employeeId","branchId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_username_key" ON "Admin"("username");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_token_key" ON "PasswordReset"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_slug_key" ON "Branch"("slug");

-- CreateIndex
CREATE INDEX "BranchSchedule_branchId_weekday_idx" ON "BranchSchedule"("branchId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "BranchSchedule_branchId_weekday_segmentIndex_key" ON "BranchSchedule"("branchId", "weekday", "segmentIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_personnelNumber_key" ON "Employee"("personnelNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_username_key" ON "Employee"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_bookingPin_key" ON "Employee"("bookingPin");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyClosing_employeeId_year_month_key" ON "MonthlyClosing"("employeeId", "year", "month");

-- CreateIndex
CREATE INDEX "DailyDay_employeeId_dayDate_idx" ON "DailyDay"("employeeId", "dayDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyDay_employeeId_dayDate_key" ON "DailyDay"("employeeId", "dayDate");

-- CreateIndex
CREATE INDEX "ShiftPlanDay_employeeId_dayDate_idx" ON "ShiftPlanDay"("employeeId", "dayDate");

-- CreateIndex
CREATE INDEX "ShiftPlanDay_branchId_idx" ON "ShiftPlanDay"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftPlanDay_employeeId_dayDate_key" ON "ShiftPlanDay"("employeeId", "dayDate");

-- CreateIndex
CREATE INDEX "ShiftPlanTemplateDay_templateId_weekday_segmentIndex_idx" ON "ShiftPlanTemplateDay"("templateId", "weekday", "segmentIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftPlanTemplateDay_templateId_weekday_segmentIndex_key" ON "ShiftPlanTemplateDay"("templateId", "weekday", "segmentIndex");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_createdAt_idx" ON "LeaveRequest"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_createdAt_idx" ON "LeaveRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "BranchSchedule" ADD CONSTRAINT "BranchSchedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkHours" ADD CONSTRAINT "WorkHours_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyHoursHistory" ADD CONSTRAINT "WeeklyHoursHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoursBank" ADD CONSTRAINT "HoursBank_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeAccount" ADD CONSTRAINT "OvertimeAccount_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SickAccount" ADD CONSTRAINT "SickAccount_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayAccount" ADD CONSTRAINT "HolidayAccount_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftPlan" ADD CONSTRAINT "ShiftPlan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FooterViewSettings" ADD CONSTRAINT "FooterViewSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusMonat" ADD CONSTRAINT "BonusMonat_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusAuszahlung" ADD CONSTRAINT "BonusAuszahlung_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBonus" ADD CONSTRAINT "EmployeeBonus_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyClosing" ADD CONSTRAINT "MonthlyClosing_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsRead" ADD CONSTRAINT "NewsRead_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsRead" ADD CONSTRAINT "NewsRead_newsId_fkey" FOREIGN KEY ("newsId") REFERENCES "News"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeNewsRead" ADD CONSTRAINT "EmployeeNewsRead_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeNewsRead" ADD CONSTRAINT "EmployeeNewsRead_newsId_fkey" FOREIGN KEY ("newsId") REFERENCES "News"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyDay" ADD CONSTRAINT "DailyDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusPayoutRequest" ADD CONSTRAINT "BonusPayoutRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusScheme" ADD CONSTRAINT "BonusScheme_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusTier" ADD CONSTRAINT "fk_bonus_tier_scheme" FOREIGN KEY ("employeeId") REFERENCES "BonusScheme"("employeeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusTier" ADD CONSTRAINT "BonusTier_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftPlanDay" ADD CONSTRAINT "ShiftPlanDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftPlanDay" ADD CONSTRAINT "ShiftPlanDay_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftPlanTemplateDay" ADD CONSTRAINT "ShiftPlanTemplateDay_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftPlanTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeWeekdayPause" ADD CONSTRAINT "EmployeeWeekdayPause_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeOvertimePayout" ADD CONSTRAINT "EmployeeOvertimePayout_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBranch" ADD CONSTRAINT "EmployeeBranch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBranch" ADD CONSTRAINT "EmployeeBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
