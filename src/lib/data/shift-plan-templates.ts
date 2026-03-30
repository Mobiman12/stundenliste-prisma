import { getPrisma } from '@/lib/prisma';

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

const NON_CANONICAL_LEGACY_GLOBAL_TEMPLATE_IDS = [27] as const;

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

const formatTimestamp = (value: Date): string => value.toISOString().slice(0, 19).replace('T', ' ');

const compareTemplateRecords = (left: ShiftPlanTemplateRecord, right: ShiftPlanTemplateRecord): number => {
  const byName = left.name.localeCompare(right.name, 'de', { sensitivity: 'base' });
  if (byName !== 0) {
    return byName;
  }
  return left.id - right.id;
};

const mapPgTemplateRecord = (template: {
  id: number;
  name: string;
  employeeId: number | null;
  createdAt: Date;
  updatedAt: Date;
}): ShiftPlanTemplateRecord => ({
  id: template.id,
  name: template.name,
  employee_id: template.employeeId,
  created_at: formatTimestamp(template.createdAt),
  updated_at: formatTimestamp(template.updatedAt),
});

const mapPgTemplateDayRecord = (day: {
  id: number;
  templateId: number;
  weekday: number;
  segmentIndex: number;
  mode: string;
  startTime: string | null;
  endTime: string | null;
  requiredPauseMinutes: number;
  label: string | null;
}): ShiftPlanTemplateDayRecord => ({
  id: day.id,
  template_id: day.templateId,
  weekday: day.weekday,
  segment_index: day.segmentIndex,
  mode: normalizeMode(day.mode),
  start_time: day.startTime,
  end_time: day.endTime,
  required_pause_minutes: day.requiredPauseMinutes,
  label: day.label,
});

function buildGroupedDays(input: ShiftPlanTemplateInput): Map<number, ShiftPlanTemplateDayInput[]> {
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
  return grouped;
}

function buildDayRows(
  templateId: number,
  grouped: Map<number, ShiftPlanTemplateDayInput[]>
): Array<{
  templateId: number;
  weekday: number;
  segmentIndex: number;
  mode: 'available' | 'unavailable';
  startTime: string | null;
  endTime: string | null;
  requiredPauseMinutes: number;
  label: string | null;
}> {
  const dayRows: Array<{
    templateId: number;
    weekday: number;
    segmentIndex: number;
    mode: 'available' | 'unavailable';
    startTime: string | null;
    endTime: string | null;
    requiredPauseMinutes: number;
    label: string | null;
  }> = [];

  for (const [weekday, segments] of grouped.entries()) {
    segments.forEach((segment, idx) => {
      const keepTimes = segment.mode === 'available';
      dayRows.push({
        templateId,
        weekday,
        segmentIndex: idx,
        mode: segment.mode,
        startTime: keepTimes ? sanitizeTime(segment.start ?? null) : null,
        endTime: keepTimes ? sanitizeTime(segment.end ?? null) : null,
        requiredPauseMinutes: keepTimes
          ? sanitizePause(segment.requiredPauseMinutes ?? 0)
          : 0,
        label: segment.mode === 'unavailable' ? segment.label ?? null : segment.label || null,
      });
    });
  }

  return dayRows;
}

function buildGlobalTemplateWhere(tenantId: string) {
  return {
    tenantId,
    employeeId: null,
    NOT: { id: { in: [...NON_CANONICAL_LEGACY_GLOBAL_TEMPLATE_IDS] } },
  };
}

export async function listShiftPlanTemplates(tenantId: string): Promise<ShiftPlanTemplateRecord[]> {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return [];
  }

  const templates = await getPrisma().shiftPlanTemplate.findMany({
    where: buildGlobalTemplateWhere(normalizedTenantId),
    select: {
      id: true,
      name: true,
      employeeId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return templates.map(mapPgTemplateRecord).sort(compareTemplateRecords);
}

export async function listShiftPlanTemplatesForEmployee(employeeId: number): Promise<ShiftPlanTemplateRecord[]> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return [];
  }

  const templates = await getPrisma().shiftPlanTemplate.findMany({
    where: { employeeId },
    select: {
      id: true,
      name: true,
      employeeId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return templates.map(mapPgTemplateRecord).sort(compareTemplateRecords);
}

export async function listShiftPlanTemplatesWithDays(tenantId: string): Promise<Array<{
  template: ShiftPlanTemplateRecord;
  days: ShiftPlanTemplateDayRecord[];
}>> {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return [];
  }

  const templates = await getPrisma().shiftPlanTemplate.findMany({
    where: buildGlobalTemplateWhere(normalizedTenantId),
    select: {
      id: true,
      name: true,
      employeeId: true,
      createdAt: true,
      updatedAt: true,
      days: {
        orderBy: [{ weekday: 'asc' }, { segmentIndex: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          templateId: true,
          weekday: true,
          segmentIndex: true,
          mode: true,
          startTime: true,
          endTime: true,
          requiredPauseMinutes: true,
          label: true,
        },
      },
    },
  });

  return templates
    .map((template) => ({
      template: mapPgTemplateRecord(template),
      days: template.days.map(mapPgTemplateDayRecord),
    }))
    .sort((left, right) => compareTemplateRecords(left.template, right.template));
}

export async function listShiftPlanTemplatesWithDaysForEmployee(employeeId: number): Promise<Array<{
  template: ShiftPlanTemplateRecord;
  days: ShiftPlanTemplateDayRecord[];
}>> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return [];
  }

  const templates = await getPrisma().shiftPlanTemplate.findMany({
    where: { employeeId },
    select: {
      id: true,
      name: true,
      employeeId: true,
      createdAt: true,
      updatedAt: true,
      days: {
        orderBy: [{ weekday: 'asc' }, { segmentIndex: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          templateId: true,
          weekday: true,
          segmentIndex: true,
          mode: true,
          startTime: true,
          endTime: true,
          requiredPauseMinutes: true,
          label: true,
        },
      },
    },
  });

  return templates
    .map((template) => ({
      template: mapPgTemplateRecord(template),
      days: template.days.map(mapPgTemplateDayRecord),
    }))
    .sort((left, right) => compareTemplateRecords(left.template, right.template));
}

export async function createShiftPlanTemplate(tenantId: string, input: ShiftPlanTemplateInput): Promise<number> {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    throw new Error('Ungültiger Tenant.');
  }

  const name = input.name.trim();
  if (!name) {
    throw new Error('Der Vorlagenname darf nicht leer sein.');
  }
  if (!Array.isArray(input.days) || input.days.length === 0) {
    throw new Error('Die Vorlage benötigt mindestens einen Tag.');
  }

  const grouped = buildGroupedDays(input);
  return getPrisma().$transaction(async (tx) => {
    const template = await tx.shiftPlanTemplate.create({
      data: {
        tenantId: normalizedTenantId,
        employeeId: null,
        name,
      },
      select: { id: true },
    });

    const dayRows = buildDayRows(template.id, grouped);
    if (dayRows.length) {
      await tx.shiftPlanTemplateDay.createMany({
        data: dayRows,
      });
    }

    return template.id;
  });
}

export async function createShiftPlanTemplateForEmployee(employeeId: number, input: ShiftPlanTemplateInput): Promise<number> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    throw new Error('Ungültiger Mitarbeiter.');
  }

  const name = input.name.trim();
  if (!name) {
    throw new Error('Der Vorlagenname darf nicht leer sein.');
  }
  if (!Array.isArray(input.days) || input.days.length === 0) {
    throw new Error('Die Vorlage benötigt mindestens einen Tag.');
  }

  const prisma = getPrisma();
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, tenantId: true },
  });
  if (!employee) {
    throw new Error('Ungültiger Mitarbeiter.');
  }

  const grouped = buildGroupedDays(input);

  return prisma.$transaction(async (tx) => {
    const template = await tx.shiftPlanTemplate.create({
      data: {
        tenantId: employee.tenantId,
        employeeId: employee.id,
        name,
      },
      select: { id: true },
    });

    const dayRows = buildDayRows(template.id, grouped);

    if (dayRows.length) {
      await tx.shiftPlanTemplateDay.createMany({
        data: dayRows,
      });
    }

    return template.id;
  });
}

export async function deleteShiftPlanTemplate(tenantId: string, templateId: number): Promise<void> {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    throw new Error('Ungültiger Tenant.');
  }
  if (!Number.isFinite(templateId) || templateId <= 0) {
    throw new Error('Ungültige Vorlage.');
  }

  await getPrisma().shiftPlanTemplate.deleteMany({
    where: {
      id: templateId,
      tenantId: normalizedTenantId,
      employeeId: null,
      NOT: { id: { in: [...NON_CANONICAL_LEGACY_GLOBAL_TEMPLATE_IDS] } },
    },
  });
}

export async function deleteShiftPlanTemplateForEmployee(employeeId: number, templateId: number): Promise<void> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    throw new Error('Ungültiger Mitarbeiter.');
  }

  await getPrisma().shiftPlanTemplate.deleteMany({
    where: {
      id: templateId,
      employeeId,
    },
  });
}
