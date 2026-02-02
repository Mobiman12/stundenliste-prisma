import { getDb } from '@/lib/db';

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

export function getReminderSettings(): ReminderSettings {
  const db = getDb();
  const row = db
    .prepare<[], ReminderSettingsRow>(
      `SELECT enabled, send_hour, subject, content_template
       FROM reminder_settings
       WHERE id = 1`
    )
    .get();

  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    enabled: Boolean(row.enabled),
    sendHour: Number.isFinite(row.send_hour) ? row.send_hour : DEFAULT_SETTINGS.sendHour,
    subject: row.subject ?? DEFAULT_SETTINGS.subject,
    contentTemplate: row.content_template ?? DEFAULT_SETTINGS.contentTemplate,
  };
}

export function saveReminderSettings(settings: ReminderSettings): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO reminder_settings (id, enabled, send_hour, subject, content_template)
       VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       enabled = excluded.enabled,
       send_hour = excluded.send_hour,
       subject = excluded.subject,
       content_template = excluded.content_template`
  ).run(settings.enabled ? 1 : 0, settings.sendHour, settings.subject, settings.contentTemplate);
}

export function listReminderLogs(limit = 12): ReminderLogEntry[] {
  const db = getDb();
  const stmt = db.prepare<
    [number],
    {
      period_key: string;
      sent_count: number;
      error_count: number;
      sent_at: string;
    }
  >(
    `SELECT period_key, sent_count, error_count, sent_at
       FROM reminder_send_log
      ORDER BY sent_at DESC
      LIMIT ?`
  );

  const rows = stmt.all(limit);
  return rows.map((row) => ({
    periodKey: row.period_key,
    sentCount: Number(row.sent_count ?? 0) || 0,
    errorCount: Number(row.error_count ?? 0) || 0,
    sentAt: row.sent_at,
  }));
}
