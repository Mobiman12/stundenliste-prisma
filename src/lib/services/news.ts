import {
  countUnreadNews,
  createNews,
  deleteNewsById,
  listNews,
  listNewsForEmployee,
  listReadNews,
  listUnreadNews,
  markNewsAsRead,
  type EmployeeNewsRow,
  type NewsRow,
} from '@/lib/data/news';

export type AdminNewsItem = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
};

export type EmployeeNewsItem = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  readAt: string | null;
  isRead: boolean;
};

function mapAdminRow(row: NewsRow): AdminNewsItem {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
  };
}

function mapEmployeeRow(row: EmployeeNewsRow): EmployeeNewsItem {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    readAt: row.read_at,
    isRead: Boolean(row.is_read),
  };
}

export function listAdminNews(): AdminNewsItem[] {
  return listNews().map(mapAdminRow);
}

export function createAdminNews(input: { title: string; content: string }): { id: number } {
  const title = input.title?.trim() ?? '';
  const content = input.content?.trim() ?? '';

  if (!title) {
    throw new Error('Titel darf nicht leer sein.');
  }
  if (!content) {
    throw new Error('Inhalt darf nicht leer sein.');
  }

  const id = createNews(title, content);
  return { id };
}

export function deleteAdminNews(id: number): boolean {
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Ungültige News-ID.');
  }
  return deleteNewsById(id);
}

export function listEmployeeNews(employeeId: number): EmployeeNewsItem[] {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return [];
  }
  return listNewsForEmployee(employeeId).map(mapEmployeeRow);
}

export function markEmployeeNewsAsRead(employeeId: number, newsId: number): void {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    throw new Error('Ungültige Mitarbeiter-ID.');
  }
  if (!Number.isFinite(newsId) || newsId <= 0) {
    throw new Error('Ungültige News-ID.');
  }
  markNewsAsRead(newsId, employeeId);
}

export function countEmployeeUnreadNews(employeeId: number): number {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return 0;
  }
  return countUnreadNews(employeeId);
}

export function listEmployeeUnreadNews(employeeId: number): EmployeeNewsItem[] {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return [];
  }
  return listUnreadNews(employeeId).map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    isRead: false,
    readAt: null,
  }));
}

export function listEmployeeReadNews(employeeId: number): EmployeeNewsItem[] {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return [];
  }
  return listReadNews(employeeId).map(mapEmployeeRow);
}
