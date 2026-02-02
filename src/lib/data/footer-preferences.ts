import { getDb } from '@/lib/db';

export type FooterPreferences = Record<string, boolean>;

function ensureTable(): void {
  const db = getDb();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS footer_view_settings (
       user_id INTEGER PRIMARY KEY,
       group_states TEXT
     )`
  ).run();
}

export function getFooterPreferences(employeeId: number): FooterPreferences | null {
  ensureTable();
  const db = getDb();
  const row = db
    .prepare<[number], { group_states: string | null }>(
      'SELECT group_states FROM footer_view_settings WHERE user_id = ?'
    )
    .get(employeeId);

  if (!row?.group_states) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.group_states) as FooterPreferences;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveFooterPreferences(employeeId: number, preferences: FooterPreferences): void {
  ensureTable();
  const db = getDb();
  const payload = JSON.stringify(preferences ?? {});
  db.prepare(
    `INSERT INTO footer_view_settings (user_id, group_states)
       VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET group_states = excluded.group_states`
  ).run(employeeId, payload);
}
