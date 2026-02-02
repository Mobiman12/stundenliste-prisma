import { getPrisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { normalizeCountry, normalizeFederalState, type CountryCode } from '@/lib/region-options';

const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

export type BranchWeekday = (typeof WEEKDAYS)[number];

export interface BranchScheduleRule {
  weekday: BranchWeekday;
  segmentIndex: number;
  startsAtMinutes: number | null;
  endsAtMinutes: number | null;
  isActive: boolean;
}

export interface BranchRecord {
  id: number;
  slug: string;
  name: string;
  timezone: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  country: string;
  federalState: string | null;
  phone: string;
  email: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  schedule: BranchScheduleRule[];
}

export interface BranchSummary {
  id: number;
  name: string;
  country?: string | null;
  federalState?: string | null;
}

export interface BranchScheduleInput {
  weekday: BranchWeekday | number | string;
  segmentIndex?: number;
  startsAtMinutes: number | null;
  endsAtMinutes: number | null;
  isActive?: boolean;
}

export interface BranchInput {
  name: string;
  slug?: string | null;
  timezone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  federalState?: string | null;
  phone?: string | null;
  email?: string | null;
  metadata?: Record<string, unknown> | string | null;
  schedule?: BranchScheduleInput[] | null;
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function sanitizeName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new Error('Name des Standorts darf nicht leer sein.');
  if (name.length > 255) throw new Error('Name des Standorts ist zu lang (max. 255 Zeichen).');
  return name;
}

function sanitizeField(raw: string | null | undefined, maxLength = 255): string {
  if (!raw) return '';
  const normalized = String(raw).replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function sanitizeJSON(raw: Record<string, unknown> | string | null | undefined): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      throw new Error('Metadata muss gültiges JSON sein.');
    }
  }
  try {
    return JSON.stringify(raw);
  } catch {
    throw new Error('Metadata konnte nicht serialisiert werden.');
  }
}

function normalizeWeekday(value: BranchWeekday | number | string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6) {
    return value;
  }
  const upper = String(value ?? '').toUpperCase().trim();
  const index = WEEKDAYS.indexOf(upper as BranchWeekday);
  if (index === -1) {
    throw new Error(`Unbekannter Wochentag "${value}". Erwartet: ${WEEKDAYS.join(', ')}`);
  }
  return index;
}

function weekdayToLabel(index: number): BranchWeekday {
  return WEEKDAYS[index] ?? 'MONDAY';
}

function normalizeMinutes(value: number | null | undefined, field: string): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) throw new Error(`${field} muss eine Zahl in Minuten sein.`);
  const minutes = Math.floor(Number(value));
  if (minutes < 0 || minutes > 1440) {
    throw new Error(`${field} muss zwischen 0 und 1440 liegen.`);
  }
  return minutes;
}

function sanitizeScheduleInput(schedule: BranchScheduleInput[] | null | undefined) {
  if (!schedule?.length) return [];

  const perDay = new Map<number, Array<{ startsAtMinutes: number | null; endsAtMinutes: number | null; isActive: boolean }>>();

  for (const entry of schedule) {
    const weekday = normalizeWeekday(entry.weekday);
    const startsAtMinutes = normalizeMinutes(entry.startsAtMinutes, 'startsAtMinutes');
    const endsAtMinutes = normalizeMinutes(entry.endsAtMinutes, 'endsAtMinutes');
    const isActive = entry.isActive === false ? false : !(startsAtMinutes == null && endsAtMinutes == null);

    if (isActive) {
      if (startsAtMinutes == null || endsAtMinutes == null) throw new Error('Aktive Öffnungszeiten benötigen Start- und Endzeit.');
      if (startsAtMinutes >= endsAtMinutes) throw new Error('Die Endzeit muss nach der Startzeit liegen.');
    }

    const list = perDay.get(weekday) ?? [];
    list.push({ startsAtMinutes: isActive ? startsAtMinutes : null, endsAtMinutes: isActive ? endsAtMinutes : null, isActive });
    perDay.set(weekday, list);
  }

  const sanitized: Array<{ weekday: number; segmentIndex: number; startsAtMinutes: number | null; endsAtMinutes: number | null; isActive: boolean }> = [];
  for (const weekday of Array.from(perDay.keys()).sort((a, b) => a - b)) {
    const list = perDay.get(weekday) ?? [];
    list.sort((a, b) => {
      if (!a.isActive && !b.isActive) return 0;
      if (!a.isActive) return 1;
      if (!b.isActive) return -1;
      return (a.startsAtMinutes ?? 0) - (b.startsAtMinutes ?? 0);
    });
    let previousEnd: number | null = null;
    list.forEach((entry, index) => {
      if (entry.isActive) {
        if (previousEnd != null && (entry.startsAtMinutes ?? 0) < previousEnd) {
          throw new Error('Öffnungszeiten dürfen sich nicht überlappen.');
        }
        previousEnd = entry.endsAtMinutes ?? null;
      }
      sanitized.push({
        weekday,
        segmentIndex: index,
        startsAtMinutes: entry.isActive ? entry.startsAtMinutes : null,
        endsAtMinutes: entry.isActive ? entry.endsAtMinutes : null,
        isActive: entry.isActive,
      });
    });
  }
  return sanitized;
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readFederalState(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const value = metadata.federalState;
  return typeof value === 'string' && value.trim().length ? value.trim() : null;
}

function writeFederalStateToMetadata(
  metadata: Record<string, unknown> | null,
  federalState: string | null,
): string | null {
  const base = metadata ? { ...metadata } : {};
  if (federalState) {
    base.federalState = federalState;
  } else {
    delete base.federalState;
  }
  const hasKeys = Object.keys(base).length > 0;
  return hasKeys ? JSON.stringify(base) : null;
}

function mapScheduleRows(rows: { weekday: number; segmentIndex: number; startsAtMinutes: number | null; endsAtMinutes: number | null; isActive: number | boolean }[]): BranchScheduleRule[] {
  return rows.map((row) => ({
    weekday: weekdayToLabel(row.weekday),
    segmentIndex: row.segmentIndex,
    startsAtMinutes: row.startsAtMinutes,
    endsAtMinutes: row.endsAtMinutes,
    isActive: Boolean(row.isActive),
  }));
}

function mapBranchRecord(branch: {
  id: number;
  slug: string | null;
  name: string;
  timezone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  metadata: string | null;
  createdAt: Date | string;
  updatedAt: Date | string | null;
  branchSchedules?: Array<{ weekday: number; segmentIndex: number; startsAtMinutes: number | null; endsAtMinutes: number | null; isActive: number | boolean }>;
}): BranchRecord {
  const parsedMetadata = parseMetadata(branch.metadata);
  const country = normalizeCountry(branch.country ?? 'DE');
  const federalState = normalizeFederalState(country, readFederalState(parsedMetadata));
  return {
    id: branch.id,
    slug: (branch.slug ?? '').trim(),
    name: branch.name,
    timezone: (branch.timezone ?? 'Europe/Berlin').trim() || 'Europe/Berlin',
    addressLine1: (branch.addressLine1 ?? '').trim(),
    addressLine2: (branch.addressLine2 ?? '').trim(),
    postalCode: (branch.postalCode ?? '').trim(),
    city: (branch.city ?? '').trim(),
    country,
    federalState,
    phone: (branch.phone ?? '').trim(),
    email: (branch.email ?? '').trim(),
    metadata: parsedMetadata,
    createdAt: branch.createdAt instanceof Date ? branch.createdAt.toISOString() : String(branch.createdAt),
    updatedAt: branch.updatedAt instanceof Date
      ? branch.updatedAt.toISOString()
      : branch.updatedAt
      ? String(branch.updatedAt)
      : branch.createdAt instanceof Date
      ? branch.createdAt.toISOString()
      : String(branch.createdAt),
    schedule: mapScheduleRows(branch.branchSchedules ?? []),
  };
}

function sanitizeBranchInput(input: BranchInput, existing?: BranchRecord | null) {
  const name = sanitizeName(input.name);
  const slugSource = input.slug ?? existing?.slug ?? slugify(name);
  const slug = slugify(slugSource) || slugify(name);
  const timezone = sanitizeField(input.timezone ?? existing?.timezone ?? 'Europe/Berlin');
  const addressLine1 = sanitizeField(input.addressLine1 ?? existing?.addressLine1 ?? '', 255);
  const addressLine2 = sanitizeField(input.addressLine2 ?? existing?.addressLine2 ?? '', 255);
  const postalCode = sanitizeField(input.postalCode ?? existing?.postalCode ?? '', 32);
  const city = sanitizeField(input.city ?? existing?.city ?? '', 255);
  const country = normalizeCountry(input.country ?? existing?.country ?? 'DE');
  const phone = sanitizeField(input.phone ?? existing?.phone ?? '', 64);
  const email = sanitizeField(input.email ?? existing?.email ?? '', 255);
  const rawMetadata = sanitizeJSON(input.metadata ?? existing?.metadata ?? null);
  const parsedMetadata = parseMetadata(rawMetadata);
  const federalState = normalizeFederalState(country as CountryCode, input.federalState ?? readFederalState(parsedMetadata));
  const metadata = writeFederalStateToMetadata(parsedMetadata, federalState);
  const schedule = sanitizeScheduleInput(input.schedule ?? existing?.schedule ?? []);

  return {
    name,
    slug,
    timezone: timezone || 'Europe/Berlin',
    addressLine1: addressLine1 || null,
    addressLine2: addressLine2 || null,
    postalCode: postalCode || null,
    city: city || null,
    country,
    federalState,
    phone: phone || null,
    email: email || null,
    metadata,
    schedule,
  };
}

async function ensureUniqueSlug(
  prisma: ReturnType<typeof getPrisma>,
  tenantId: string,
  slug: string,
  excludeId?: number
) {
  const existing = await prisma.branch.findFirst({
    where: {
      tenantId,
      slug,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw new Error(`Slug "${slug}" wird bereits verwendet.`);
  }
}

export async function listBranches(tenantId: string): Promise<BranchRecord[]> {
  const prisma = getPrisma();
  const rows = await prisma.branch.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
    include: {
      branchSchedules: {
        orderBy: [{ weekday: 'asc' }, { segmentIndex: 'asc' }],
      },
    },
  });
  return rows.map(mapBranchRecord);
}

export async function getBranchById(tenantId: string, id: number): Promise<BranchRecord | null> {
  const prisma = getPrisma();
  const row = await prisma.branch.findFirst({
    where: { id, tenantId },
    include: { branchSchedules: { orderBy: [{ weekday: 'asc' }, { segmentIndex: 'asc' }] } },
  });
  return row ? mapBranchRecord(row) : null;
}

export async function createBranch(tenantId: string, input: BranchInput): Promise<number> {
  const prisma = getPrisma();
  const sanitized = sanitizeBranchInput(input);
  await ensureUniqueSlug(prisma, tenantId, sanitized.slug);

  const branch = await prisma.branch.create({
    data: {
      tenantId,
      name: sanitized.name,
      slug: sanitized.slug,
      timezone: sanitized.timezone,
      addressLine1: sanitized.addressLine1,
      addressLine2: sanitized.addressLine2,
      postalCode: sanitized.postalCode,
      city: sanitized.city,
      country: sanitized.country,
      phone: sanitized.phone,
      email: sanitized.email,
      metadata: sanitized.metadata,
      branchSchedules: {
        create: sanitized.schedule.map((entry) => ({
          weekday: entry.weekday,
          segmentIndex: entry.segmentIndex,
          startsAtMinutes: entry.startsAtMinutes,
          endsAtMinutes: entry.endsAtMinutes,
          isActive: entry.isActive ? 1 : 0,
        })),
      },
    },
    include: { branchSchedules: true },
  });

  return branch.id;
}

export async function updateBranch(tenantId: string, id: number, input: BranchInput): Promise<void> {
  const prisma = getPrisma();
  const existing = await getBranchById(tenantId, id);
  if (!existing) throw new Error('Standort wurde nicht gefunden.');

  const sanitized = sanitizeBranchInput(input, existing);
  await ensureUniqueSlug(prisma, tenantId, sanitized.slug, id);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.branchSchedule.deleteMany({ where: { branchId: id } });
    await tx.branch.update({
      where: { id },
      data: {
        name: sanitized.name,
        slug: sanitized.slug,
        timezone: sanitized.timezone,
        addressLine1: sanitized.addressLine1,
        addressLine2: sanitized.addressLine2,
        postalCode: sanitized.postalCode,
        city: sanitized.city,
        country: sanitized.country,
        phone: sanitized.phone,
        email: sanitized.email,
        metadata: sanitized.metadata,
        branchSchedules: {
          create: sanitized.schedule.map((entry) => ({
            weekday: entry.weekday,
            segmentIndex: entry.segmentIndex,
            startsAtMinutes: entry.startsAtMinutes,
            endsAtMinutes: entry.endsAtMinutes,
            isActive: entry.isActive ? 1 : 0,
          })),
        },
      },
    });
  });
}

export async function deleteBranch(tenantId: string, id: number): Promise<void> {
  const prisma = getPrisma();
  const existing = await prisma.branch.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) throw new Error('Standort wurde nicht gefunden.');
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.shiftPlanDay.updateMany({ where: { branchId: id }, data: { branchId: null } });
    await tx.employeeBranch.deleteMany({ where: { branchId: id } });
    await tx.branchSchedule.deleteMany({ where: { branchId: id } });
    await tx.branch.delete({ where: { id } });
  });
}

export async function listBranchesForEmployee(tenantId: string, employeeId: number): Promise<BranchSummary[]> {
  const prisma = getPrisma();
  const rows: Array<{
    branch: {
      id: number;
      name: string;
      country: string | null;
      metadata: string | null;
    };
  }> = await prisma.employeeBranch.findMany({
    where: { employeeId, branch: { tenantId } },
    include: { branch: { select: { id: true, name: true, country: true, metadata: true } } },
    orderBy: { branch: { name: 'asc' } },
  });
  return rows.map((row) => {
    const country = normalizeCountry(row.branch.country ?? 'DE');
    const metadata = parseMetadata(row.branch.metadata ?? null);
    const federalState = normalizeFederalState(country, readFederalState(metadata));
    return {
      id: row.branch.id,
      name: row.branch.name,
      country,
      federalState,
    };
  });
}

export async function listBranchesForEmployees(
  tenantId: string,
  employeeIds: number[]
): Promise<Map<number, BranchSummary[]>> {
  const prisma = getPrisma();
  const map = new Map<number, BranchSummary[]>();
  if (!employeeIds.length) return map;

  const rows = await prisma.employeeBranch.findMany({
    where: { employeeId: { in: employeeIds }, branch: { tenantId } },
    include: { branch: { select: { id: true, name: true, country: true, metadata: true } } },
    orderBy: [{ employeeId: 'asc' }, { branch: { name: 'asc' } }],
  });

  for (const row of rows) {
    const list = map.get(row.employeeId) ?? [];
    const country = normalizeCountry(row.branch.country ?? 'DE');
    const metadata = parseMetadata(row.branch.metadata ?? null);
    const federalState = normalizeFederalState(country, readFederalState(metadata));
    list.push({ id: row.branch.id, name: row.branch.name, country, federalState });
    map.set(row.employeeId, list);
  }
  return map;
}

export async function replaceEmployeeBranches(
  tenantId: string,
  employeeId: number,
  branchIds: number[]
): Promise<void> {
  const prisma = getPrisma();
  const uniqueIds = Array.from(new Set(branchIds.filter((id) => Number.isFinite(id) && id > 0))).map((id) =>
    Number(id)
  );
  if (uniqueIds.length) {
    const count = await prisma.branch.count({ where: { id: { in: uniqueIds }, tenantId } });
    if (count !== uniqueIds.length) {
      throw new Error('Eine oder mehrere ausgewählte Standorte existieren nicht mehr.');
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.employeeBranch.deleteMany({ where: { employeeId } });
    if (uniqueIds.length) {
      await tx.employeeBranch.createMany({
        data: uniqueIds.map((branchId) => ({ employeeId, branchId })),
        skipDuplicates: true,
      });
    }
  });
}

export async function employeeHasBranch(
  tenantId: string,
  employeeId: number,
  branchId: number
): Promise<boolean> {
  const prisma = getPrisma();
  const row = await prisma.employeeBranch.findFirst({
    where: { employeeId, branchId, branch: { tenantId } },
    select: { employeeId: true },
  });
  return Boolean(row);
}
