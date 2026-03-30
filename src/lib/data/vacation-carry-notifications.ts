import type { VacationCarryNotification } from '@prisma/client';

import { getPrisma } from '@/lib/prisma';
import { resolveCarryExpiryIsoForYear } from '@/lib/services/vacation-balance';

export type VacationCarryNotificationStatus = 'pending' | 'smtp_accepted' | 'failed';

export interface VacationCarryNotificationRow {
  id: number;
  tenantId: string;
  employeeId: number;
  year: number;
  channel: string;
  recipient: string | null;
  fromName: string | null;
  subject: string | null;
  bodyText: string | null;
  status: VacationCarryNotificationStatus;
  providerMessageId: string | null;
  providerResponse: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: VacationCarryNotification): VacationCarryNotificationRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    employeeId: row.employeeId,
    year: row.year,
    channel: row.channel,
    recipient: row.recipient ?? null,
    fromName: row.fromName ?? null,
    subject: row.subject ?? null,
    bodyText: row.bodyText ?? null,
    status: (row.status as VacationCarryNotificationStatus) ?? 'pending',
    providerMessageId: row.providerMessageId ?? null,
    providerResponse: row.providerResponse ?? null,
    errorMessage: row.errorMessage ?? null,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createVacationCarryNotificationAttempt(input: {
  tenantId: string;
  employeeId: number;
  year: number;
  recipient: string;
  fromName?: string | null;
  subject?: string | null;
  bodyText?: string | null;
}): Promise<VacationCarryNotificationRow | null> {
  const prisma = getPrisma();
  try {
    const created = await prisma.vacationCarryNotification.create({
      data: {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        year: input.year,
        channel: 'email',
        recipient: input.recipient,
        fromName: input.fromName ?? null,
        subject: input.subject ?? null,
        bodyText: input.bodyText ?? null,
        status: 'pending',
      },
    });
    return mapRow(created);
  } catch (error) {
    const maybeCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
    if (maybeCode === 'P2002') {
      return null;
    }
    throw error;
  }
}

export async function hasSuccessfulVacationCarryNotificationBefore(input: {
  tenantId: string;
  employeeId: number;
  year: number;
  expiryValue: string;
}): Promise<boolean> {
  const prisma = getPrisma();
  const latestIsoDate = resolveCarryExpiryIsoForYear(input.year, input.expiryValue);
  if (!latestIsoDate) {
    return false;
  }
  const latest = new Date(`${latestIsoDate}T23:59:59.999Z`);
  if (Number.isNaN(latest.getTime())) {
    return false;
  }
  const row = await prisma.vacationCarryNotification.findFirst({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      year: input.year,
      status: 'smtp_accepted',
      sentAt: { lte: latest },
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function updateVacationCarryNotificationResult(
  id: number,
  result: {
    status: VacationCarryNotificationStatus;
    providerMessageId?: string | null;
    providerResponse?: string | null;
    errorMessage?: string | null;
    sentAt?: Date | null;
  }
): Promise<void> {
  const prisma = getPrisma();
  await prisma.vacationCarryNotification.update({
    where: { id },
    data: {
      status: result.status,
      providerMessageId: result.providerMessageId ?? null,
      providerResponse: result.providerResponse ?? null,
      errorMessage: result.errorMessage ?? null,
      sentAt: result.sentAt ?? null,
      updatedAt: new Date(),
    },
  });
}

export async function listVacationCarryNotificationsForEmployee(
  tenantId: string,
  employeeId: number,
  limit = 20
): Promise<VacationCarryNotificationRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.vacationCarryNotification.findMany({
    where: { tenantId, employeeId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return rows.map(mapRow);
}
