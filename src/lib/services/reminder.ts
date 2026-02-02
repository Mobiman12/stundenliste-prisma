import { DateTime } from 'luxon';

import {
  getReminderSettings as readReminderSettings,
  listReminderLogs,
  saveReminderSettings,
  type ReminderLogEntry,
  type ReminderSettings,
} from '@/lib/data/reminders';
import { sendTextMail } from '@/lib/services/email';

export const ALLOWED_REMINDER_KEYS = new Set(['first_name', 'month']);
const MONTHS_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

const DEFAULT_TZ = process.env.REMINDER_TZ || 'Europe/Berlin';

export type ReminderSettingsInput = ReminderSettings;

export interface ReminderPreview {
  subject: string;
  body: string;
}

function getNow(): DateTime {
  return DateTime.now().setZone(DEFAULT_TZ, { keepLocalTime: false });
}

export function extractPlaceholders(template: string): Set<string> {
  const result = new Set<string>();
  if (!template) {
    return result;
  }

  const regex = /\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const key = match[1]?.trim();
    if (key) {
      result.add(key);
    }
  }
  return result;
}

function evaluateTemplate(template: string, values: Record<string, string>): string {
  if (!template) {
    return '';
  }

  return template.replace(/\{([^{}]+)\}/g, (full, rawKey: string) => {
    const key = rawKey.trim();
    if (!(key in values)) {
      throw new Error(key);
    }
    return values[key];
  });
}

export function buildPreview(
  settings: ReminderSettings,
  firstName: string,
  now: DateTime = getNow()
): ReminderPreview {
  const safeName = firstName?.trim() || 'Alex';
  const monthName = MONTHS_DE[now.month - 1] ?? String(now.month);
  const values = {
    first_name: safeName,
    month: monthName,
  };

  const subject = evaluateTemplate(settings.subject, values);
  const body = evaluateTemplate(settings.contentTemplate, values);

  return { subject, body };
}

export function getReminderSettings(): ReminderSettings {
  return readReminderSettings();
}

export function sanitizeReminderSettings(settings: ReminderSettingsInput): {
  settings: ReminderSettings;
  unknownKeys: string[];
} {
  const normalized: ReminderSettings = {
    enabled: Boolean(settings.enabled),
    sendHour: Math.min(Math.max(Number(settings.sendHour) || 0, 0), 23),
    subject: settings.subject?.trim() ?? '',
    contentTemplate: settings.contentTemplate ?? '',
  };

  const keys = new Set<string>();
  const subjectKeys = extractPlaceholders(normalized.subject);
  const bodyKeys = extractPlaceholders(normalized.contentTemplate);
  for (const key of subjectKeys) keys.add(key);
  for (const key of bodyKeys) keys.add(key);

  const unknown = Array.from(keys).filter((key) => !ALLOWED_REMINDER_KEYS.has(key));

  return { settings: normalized, unknownKeys: unknown };
}

export function updateReminderSettings(settings: ReminderSettingsInput): {
  settings: ReminderSettings;
  unknownKeys: string[];
} {
  const result = sanitizeReminderSettings(settings);
  if (!result.unknownKeys.length) {
    saveReminderSettings(result.settings);
  }
  return result;
}

export function getReminderLogs(limit = 12): ReminderLogEntry[] {
  return listReminderLogs(limit);
}

export function nextScheduledDate(sendHour: number, now: DateTime = getNow()): DateTime {
  const clampedHour = Math.min(Math.max(sendHour, 0), 23);
  const currentMonthTarget = now
    .endOf('month')
    .set({ hour: clampedHour, minute: 0, second: 0, millisecond: 0 });

  if (now <= currentMonthTarget) {
    return currentMonthTarget;
  }

  return currentMonthTarget
    .plus({ months: 1 })
    .endOf('month')
    .set({ hour: clampedHour, minute: 0, second: 0, millisecond: 0 });
}

export function formatNextScheduled(sendHour: number, locale = 'de-DE'): string {
  const dt = nextScheduledDate(sendHour).setLocale(locale);
  return dt.toFormat('dd.LL.yyyy HH:mm ZZZZ');
}

export async function sendReminderTestMail(options: {
  to: string;
  settings: ReminderSettings;
  previewName?: string;
}): Promise<void> {
  const { to, settings, previewName } = options;
  const preview = buildPreview(settings, previewName ?? 'Alex');
  await sendTextMail(to, preview.subject, preview.body);
}
