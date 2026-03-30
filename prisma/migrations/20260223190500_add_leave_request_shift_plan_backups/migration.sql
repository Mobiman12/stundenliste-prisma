CREATE TABLE IF NOT EXISTS "leave_request_shift_plan_backups" (
  "id" SERIAL PRIMARY KEY,
  "leave_request_id" INTEGER NOT NULL,
  "employee_id" INTEGER NOT NULL,
  "day_date" TEXT NOT NULL,
  "segment_index" INTEGER NOT NULL DEFAULT 0,
  "mode" TEXT NOT NULL DEFAULT 'available',
  "start_time" TEXT,
  "end_time" TEXT,
  "required_pause_minutes" INTEGER NOT NULL DEFAULT 0,
  "label" TEXT,
  "branch_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_request_shift_plan_backups_leave_request_id_fkey"
    FOREIGN KEY ("leave_request_id") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leave_request_shift_plan_backups_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leave_request_shift_plan_backups_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "leave_request_shift_plan_backups_unique_per_segment"
  ON "leave_request_shift_plan_backups"("leave_request_id", "day_date", "segment_index");

CREATE INDEX IF NOT EXISTS "leave_request_shift_plan_backups_leave_request_date_idx"
  ON "leave_request_shift_plan_backups"("leave_request_id", "day_date");

CREATE INDEX IF NOT EXISTS "leave_request_shift_plan_backups_employee_date_idx"
  ON "leave_request_shift_plan_backups"("employee_id", "day_date");
