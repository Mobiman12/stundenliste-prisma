import { getDb } from '@/lib/db';

export type ShiftPlanTemplateRecord = {
  id: number;
  name: string;
  employee_id: number | null;
  created_at: string;
  updated_at: string;
};

export type ShiftPlanTemplateDayRecord = {
  id: number;
  template_id: number;
  weekday: number;
  segment_index: number;
  mode: 'available' | 'unavailable';
  start_time: string | null;
  end_time: string | null;
  required_pause_minutes: number;
  label: string | null;
};

export type ShiftPlanTemplateDayInput = {
  weekday: number;
  segmentIndex?: number;
  mode: 'available' | 'unavailable';
  start?: string | null;
  end?: string | null;
  requiredPauseMinutes?: number | null;
  label?: string | null;
};

export type ShiftPlanTemplateInput = {
  name: string;
  days: ShiftPlanTemplateDayInput[];
};

const sanitizeTime = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
};

const sanitizePause = (value: number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
};

const normalizeMode = (mode: string | null | undefined): 'available' | 'unavailable' => {
  if ((mode ?? '').toLowerCase() === 'unavailable') return 'unavailable';
  return 'available';
};

export function listShiftPlanTemplates(): ShiftPlanTemplateRecord[] {
  const db = getDb();
  return db
    .prepare<[], ShiftPlanTemplateRecord>(
      `SELECT id, name, employee_id, created_at, updated_at
       FROM shift_plan_templates
       WHERE employee_id IS NULL
       ORDER BY name COLLATE NOCASE ASC`
    )
    .all() as ShiftPlanTemplateRecord[];
}

export function listShiftPlanTemplatesForEmployee(employeeId: number): ShiftPlanTemplateRecord[] {
  const db = getDb();
  return db
    .prepare<[number], ShiftPlanTemplateRecord>(
      `SELECT id, name, employee_id, created_at, updated_at
       FROM shift_plan_templates
       WHERE employee_id = ?
       ORDER BY name COLLATE NOCASE ASC`
    )
    .all(employeeId) as ShiftPlanTemplateRecord[];
}

export function getShiftPlanTemplateWithDays(
  templateId: number
): { template: ShiftPlanTemplateRecord; days: ShiftPlanTemplateDayRecord[] } | null {
  const db = getDb();
  const template = db
    .prepare<[number], ShiftPlanTemplateRecord>(
      `SELECT id, name, employee_id, created_at, updated_at
       FROM shift_plan_templates
       WHERE id = ?`
    )
    .get(templateId) as ShiftPlanTemplateRecord | undefined;

  if (!template) {
    return null;
  }

  const days = db
    .prepare<[number], ShiftPlanTemplateDayRecord>(
      `SELECT id, template_id, weekday, segment_index, mode, start_time, end_time, required_pause_minutes, label
       FROM shift_plan_template_days
       WHERE template_id = ?
       ORDER BY weekday ASC, segment_index ASC`
    )
    .all(templateId) as ShiftPlanTemplateDayRecord[];

  return { template, days };
}

export function listShiftPlanTemplatesWithDays(): Array<{
  template: ShiftPlanTemplateRecord;
  days: ShiftPlanTemplateDayRecord[];
}> {
  const templates = listShiftPlanTemplates();
  if (!templates.length) {
    return [];
  }
  const ids = templates.map((template) => template.id);
  const placeholders = ids.map(() => '?').join(', ');
  const db = getDb();

  const rows = db
    .prepare<(number | string)[], ShiftPlanTemplateDayRecord>(
      `SELECT id, template_id, weekday, segment_index, mode, start_time, end_time, required_pause_minutes, label
       FROM shift_plan_template_days
       WHERE template_id IN (${placeholders})
       ORDER BY template_id ASC, weekday ASC, segment_index ASC`
    )
    .all(...ids) as ShiftPlanTemplateDayRecord[];

  const grouped = new Map<number, ShiftPlanTemplateDayRecord[]>();
  for (const row of rows) {
    const existing = grouped.get(row.template_id) ?? [];
    existing.push(row);
    grouped.set(row.template_id, existing);
  }

  return templates.map((template) => ({
    template,
    days: grouped.get(template.id) ?? [],
  }));
}

export function listShiftPlanTemplatesWithDaysForEmployee(employeeId: number): Array<{
  template: ShiftPlanTemplateRecord;
  days: ShiftPlanTemplateDayRecord[];
}> {
  const templates = listShiftPlanTemplatesForEmployee(employeeId);
  if (!templates.length) {
    return [];
  }
  const ids = templates.map((template) => template.id);
  const placeholders = ids.map(() => '?').join(', ');
  const db = getDb();

  const rows = db
    .prepare<(number | string)[], ShiftPlanTemplateDayRecord>(
      `SELECT id, template_id, weekday, segment_index, mode, start_time, end_time, required_pause_minutes, label
       FROM shift_plan_template_days
       WHERE template_id IN (${placeholders})
       ORDER BY template_id ASC, weekday ASC, segment_index ASC`
    )
    .all(...ids) as ShiftPlanTemplateDayRecord[];

  const grouped = new Map<number, ShiftPlanTemplateDayRecord[]>();
  for (const row of rows) {
    const existing = grouped.get(row.template_id) ?? [];
    existing.push(row);
    grouped.set(row.template_id, existing);
  }

  return templates.map((template) => ({
    template,
    days: grouped.get(template.id) ?? [],
  }));
}

function createShiftPlanTemplateInternal(input: ShiftPlanTemplateInput, employeeId: number | null): number {
  const db = getDb();
  const name = input.name.trim();
  if (!name) {
    throw new Error('Der Vorlagenname darf nicht leer sein.');
  }
  if (!Array.isArray(input.days) || input.days.length === 0) {
    throw new Error('Die Vorlage benötigt mindestens einen Tag.');
  }

  const insertTemplate = db.prepare(
    `INSERT INTO shift_plan_templates (name, employee_id) VALUES (@name, @employee_id)`
  );

  const insertDay = db.prepare(
    `INSERT INTO shift_plan_template_days (
      template_id,
      weekday,
      segment_index,
      mode,
      start_time,
      end_time,
      required_pause_minutes,
      label
    ) VALUES (
      @template_id,
      @weekday,
      @segment_index,
      @mode,
      @start_time,
      @end_time,
      @required_pause_minutes,
      @label
    )`
  );

  const transaction = db.transaction(() => {
    const templateResult = insertTemplate.run({ name, employee_id: employeeId });
    const templateId = Number(templateResult.lastInsertRowid);

    const grouped = new Map<number, ShiftPlanTemplateDayInput[]>();
    for (const entry of input.days) {
      const weekday = Number(entry.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        continue;
      }
      const mode = normalizeMode(entry.mode);
      const items = grouped.get(weekday) ?? [];
      items.push({
        weekday,
        mode,
        start: mode === 'available' ? sanitizeTime(entry.start ?? null) : null,
        end: mode === 'available' ? sanitizeTime(entry.end ?? null) : null,
        requiredPauseMinutes: mode === 'available' ? sanitizePause(entry.requiredPauseMinutes ?? null) : 0,
        label: entry.label?.trim() || null,
      });
      grouped.set(weekday, items);
    }

    for (const [weekday, segments] of grouped.entries()) {
      segments.forEach((segment, idx) => {
        const keepTimes = segment.mode === 'available';
        insertDay.run({
          template_id: templateId,
          weekday,
          segment_index: idx,
          mode: segment.mode,
          start_time: keepTimes ? segment.start : null,
          end_time: keepTimes ? segment.end : null,
          required_pause_minutes: keepTimes
            ? sanitizePause(segment.requiredPauseMinutes ?? 0)
            : 0,
          label: segment.mode === 'unavailable' ? segment.label : segment.label || null,
        });
      });
    }

    return templateId;
  });

  return transaction();
}

export function createShiftPlanTemplate(input: ShiftPlanTemplateInput): number {
  return createShiftPlanTemplateInternal(input, null);
}

export function createShiftPlanTemplateForEmployee(employeeId: number, input: ShiftPlanTemplateInput): number {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    throw new Error('Ungültiger Mitarbeiter.');
  }
  return createShiftPlanTemplateInternal(input, employeeId);
}

export function deleteShiftPlanTemplate(templateId: number): void {
  const db = getDb();
  db.prepare(`DELETE FROM shift_plan_templates WHERE id = ?`).run(templateId);
}

export function deleteShiftPlanTemplateForEmployee(employeeId: number, templateId: number): void {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    throw new Error('Ungültiger Mitarbeiter.');
  }
  const db = getDb();
  db.prepare(`DELETE FROM shift_plan_templates WHERE id = ? AND employee_id = ?`).run(templateId, employeeId);
}
