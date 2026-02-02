import { getDb } from '@/lib/db';

export type NewsRow = {
  id: number;
  title: string;
  content: string;
  created_at: string;
};

export type EmployeeNewsRow = {
  id: number;
  title: string;
  content: string;
  created_at: string;
  is_read: number;
  read_at: string | null;
};

export function listNews(): NewsRow[] {
  const db = getDb();
  const stmt = db.prepare<[], NewsRow>(
    `SELECT id, title, content, created_at
       FROM news
      ORDER BY datetime(created_at) DESC, id DESC`
  );
  return stmt.all();
}

export function createNews(title: string, content: string): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO news (title, content)
       VALUES (?, ?)`
    )
    .run(title, content);
  return Number(info.lastInsertRowid ?? 0);
}

export function deleteNewsById(id: number): boolean {
  const db = getDb();
  const info = db.prepare(`DELETE FROM news WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function listNewsForEmployee(employeeId: number): EmployeeNewsRow[] {
  const db = getDb();
  const stmt = db.prepare<
    [number],
    EmployeeNewsRow
  >(
    `SELECT
        n.id,
        n.title,
        n.content,
        n.created_at,
        CASE WHEN nr.news_id IS NULL THEN 0 ELSE 1 END AS is_read,
        nr.read_at
       FROM news n
  LEFT JOIN news_read nr
         ON nr.news_id = n.id
        AND nr.employee_id = ?
   ORDER BY datetime(n.created_at) DESC, n.id DESC`
  );

  return stmt.all(employeeId);
}

export function markNewsAsRead(newsId: number, employeeId: number): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO news_read (employee_id, news_id)
     VALUES (?, ?)`
  ).run(employeeId, newsId);
}

export function countUnreadNews(employeeId: number): number {
  const db = getDb();
  const row = db
    .prepare<
      [number],
      { total: number }
    >(
      `SELECT COUNT(*) as total
         FROM news n
    LEFT JOIN news_read nr
           ON nr.news_id = n.id
          AND nr.employee_id = ?
        WHERE nr.news_id IS NULL`
    )
    .get(employeeId);
  return Number(row?.total ?? 0);
}

export function listUnreadNews(employeeId: number): NewsRow[] {
  const db = getDb();
  const stmt = db.prepare<
    [number],
    NewsRow
  >(
    `SELECT n.id, n.title, n.content, n.created_at
       FROM news n
  LEFT JOIN news_read nr
         ON nr.news_id = n.id
        AND nr.employee_id = ?
      WHERE nr.news_id IS NULL
   ORDER BY datetime(n.created_at) DESC, n.id DESC`
  );
  return stmt.all(employeeId);
}

export function listReadNews(employeeId: number): EmployeeNewsRow[] {
  const db = getDb();
  const stmt = db.prepare<
    [number],
    EmployeeNewsRow
  >(
    `SELECT
        n.id,
        n.title,
        n.content,
        n.created_at,
        1 AS is_read,
        nr.read_at
       FROM news n
  JOIN news_read nr
         ON nr.news_id = n.id
        AND nr.employee_id = ?
   ORDER BY datetime(nr.read_at) DESC, n.id DESC`
  );
  return stmt.all(employeeId);
}
