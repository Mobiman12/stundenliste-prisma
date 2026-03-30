import { getPrisma } from '@/lib/prisma';

export interface ReminderSettingsRow {
  enabled: number;
  send_hour: number;
  subject: string;
  content_template: string;
}

export interface ReminderSettings {
  enabled: boolean;
  sendHour: number;
  subject: string;
  contentTemplate: string;
}

export interface ReminderLogEntry {
  periodKey: string;
  sentCount: number;
  errorCount: number;
  sentAt: string;
}

const DEFAULT_SETTINGS: ReminderSettings = {
  enabled: false,
  sendHour: 18,
  subject: 'Erinnerung: Stundenliste vervollständigen',
  contentTemplate:
    'Lieber {first_name},\n\nfalls noch nicht geschehen, denk bitte dran, Deine Stundenliste für diesen Monat ({month}) zu vervollständigen.\n\nViele Grüße',
};

export async function getReminderSettings(tenantId: string): Promise<ReminderSettings> {
  const prisma = getPrisma();
  const row = await prisma.reminderSettings.findFirst({
    where: {
      tenantId,
      id: 1,
    },
    select: {
      enabled: true,
      sendHour: true,
      subject: true,
      contentTemplate: true,
    },
  });

  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    enabled: Boolean(row.enabled),
    sendHour: Number.isFinite(row.sendHour) ? row.sendHour : DEFAULT_SETTINGS.sendHour,
    subject: row.subject ?? DEFAULT_SETTINGS.subject,
    contentTemplate: row.contentTemplate ?? DEFAULT_SETTINGS.contentTemplate,
  };
}

export async function saveReminderSettings(tenantId: string, settings: ReminderSettings): Promise<void> {
  const prisma = getPrisma();
  const data = {
    enabled: settings.enabled ? 1 : 0,
    sendHour: settings.sendHour,
    subject: settings.subject,
    contentTemplate: settings.contentTemplate,
  };

  const updated = await prisma.reminderSettings.updateMany({
    where: {
      tenantId,
      id: 1,
    },
    data,
  });

  if (updated.count > 0) {
    return;
  }

  const conflictingRow = await prisma.reminderSettings.findFirst({
    where: {
      id: 1,
      NOT: { tenantId },
    },
    select: { tenantId: true },
  });

  if (conflictingRow) {
    throw new Error(
      `ReminderSettings legacy primary-key conflict for id=1 (existing tenant ${conflictingRow.tenantId})`
    );
  }

  await prisma.reminderSettings.create({
    data: {
      tenantId,
      id: 1,
      ...data,
    },
  });
}

export async function listReminderLogs(tenantId: string, limit = 12): Promise<ReminderLogEntry[]> {
  const prisma = getPrisma();
  const rows = await prisma.reminderSendLog.findMany({
    where: { tenantId },
    orderBy: { sentAt: 'desc' },
    take: limit,
    select: {
      periodKey: true,
      sentCount: true,
      errorCount: true,
      sentAt: true,
    },
  });

  return rows.map((row) => ({
    periodKey: row.periodKey,
    sentCount: Number(row.sentCount ?? 0) || 0,
    errorCount: Number(row.errorCount ?? 0) || 0,
    sentAt: row.sentAt.toISOString(),
  }));
}
