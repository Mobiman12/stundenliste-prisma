import { getPrisma } from '@/lib/prisma';

export type LeaveRequestShiftPlanBackupRow = {
  id: number;
  leave_request_id: number;
  employee_id: number;
  day_date: string;
  segment_index: number;
  mode: 'available' | 'unavailable';
  start_time: string | null;
  end_time: string | null;
  required_pause_minutes: number;
  label: string | null;
  branch_id: number | null;
};

export type LeaveRequestShiftPlanBackupInput = {
  leaveRequestId: number;
  employeeId: number;
  dayDate: string;
  segmentIndex: number;
  mode: 'available' | 'unavailable';
  startTime: string | null;
  endTime: string | null;
  requiredPauseMinutes: number;
  label: string | null;
  branchId: number | null;
};

let tableEnsured = false;

async function ensureBackupTable(): Promise<void> {
  if (tableEnsured) {
    return;
  }
  const prisma = getPrisma();
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "leave_request_shift_plan_backups" (
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
    )`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "leave_request_shift_plan_backups_unique_per_segment"
     ON "leave_request_shift_plan_backups"("leave_request_id", "day_date", "segment_index")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "leave_request_shift_plan_backups_leave_request_date_idx"
     ON "leave_request_shift_plan_backups"("leave_request_id", "day_date")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "leave_request_shift_plan_backups_employee_date_idx"
     ON "leave_request_shift_plan_backups"("employee_id", "day_date")`,
  );
  tableEnsured = true;
}

export async function replaceLeaveRequestShiftPlanBackups(
  tenantId: string,
  leaveRequestId: number,
  entries: LeaveRequestShiftPlanBackupInput[],
): Promise<void> {
  void tenantId;
  await ensureBackupTable();
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `DELETE FROM "leave_request_shift_plan_backups"
       WHERE leave_request_id = $1`,
      leaveRequestId,
    );

    if (!entries.length) {
      return;
    }

    for (const entry of entries) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "leave_request_shift_plan_backups"
         (leave_request_id, employee_id, day_date, segment_index, mode, start_time, end_time, required_pause_minutes, label, branch_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (leave_request_id, day_date, segment_index)
         DO UPDATE SET
           employee_id = EXCLUDED.employee_id,
           mode = EXCLUDED.mode,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           required_pause_minutes = EXCLUDED.required_pause_minutes,
           label = EXCLUDED.label,
           branch_id = EXCLUDED.branch_id`,
        leaveRequestId,
        entry.employeeId,
        entry.dayDate,
        Math.max(0, Math.floor(Number(entry.segmentIndex) || 0)),
        entry.mode === 'unavailable' ? 'unavailable' : 'available',
        entry.startTime ?? null,
        entry.endTime ?? null,
        Math.max(0, Math.floor(Number(entry.requiredPauseMinutes) || 0)),
        entry.label ?? null,
        entry.branchId ?? null,
      );
    }
  });
}

export async function listLeaveRequestShiftPlanBackups(
  tenantId: string,
  leaveRequestId: number,
): Promise<LeaveRequestShiftPlanBackupRow[]> {
  await ensureBackupTable();
  const prisma = getPrisma();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT b.id,
            b.leave_request_id,
            b.employee_id,
            b.day_date,
            b.segment_index,
            b.mode,
            b.start_time,
            b.end_time,
            b.required_pause_minutes,
            b.label,
            b.branch_id
     FROM "leave_request_shift_plan_backups" b
     JOIN "LeaveRequest" lr ON lr.id = b.leave_request_id
     JOIN "Employee" e ON e.id = lr."employeeId"
     WHERE b.leave_request_id = $1
       AND e."tenantId" = $2
     ORDER BY b.day_date ASC, b.segment_index ASC`,
    leaveRequestId,
    tenantId,
  )) as LeaveRequestShiftPlanBackupRow[];

  return rows.map((row) => ({
    ...row,
    mode: row.mode === 'unavailable' ? 'unavailable' : 'available',
    start_time: row.start_time ?? null,
    end_time: row.end_time ?? null,
    label: row.label ?? null,
    branch_id: row.branch_id ?? null,
  }));
}

export async function deleteLeaveRequestShiftPlanBackups(
  tenantId: string,
  leaveRequestId: number,
): Promise<void> {
  void tenantId;
  await ensureBackupTable();
  const prisma = getPrisma();
  await prisma.$executeRawUnsafe(
    `DELETE FROM "leave_request_shift_plan_backups"
     WHERE leave_request_id = $1`,
    leaveRequestId,
  );
}
