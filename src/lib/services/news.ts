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

export async function listAdminNews(tenantId: string): Promise<AdminNewsItem[]> {
  return (await listNews(tenantId)).map(mapAdminRow);
}

export async function createAdminNews(
  tenantId: string,
  input: { title: string; content: string }
): Promise<{ id: number }> {
  const title = input.title?.trim() ?? '';
  const content = input.content?.trim() ?? '';

  if (!title) {
    throw new Error('Titel darf nicht leer sein.');
  }
  if (!content) {
    throw new Error('Inhalt darf nicht leer sein.');
  }

  const id = await createNews(tenantId, title, content);
  return { id };
}

export async function deleteAdminNews(tenantId: string, id: number): Promise<boolean> {
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Ungültige News-ID.');
  }
  return deleteNewsById(tenantId, id);
}

export async function listEmployeeNews(tenantId: string, employeeId: number): Promise<EmployeeNewsItem[]> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return [];
  }
  return (await listNewsForEmployee(tenantId, employeeId)).map(mapEmployeeRow);
}

export async function markEmployeeNewsAsRead(tenantId: string, employeeId: number, newsId: number): Promise<void> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    throw new Error('Ungültige Mitarbeiter-ID.');
  }
  if (!Number.isFinite(newsId) || newsId <= 0) {
    throw new Error('Ungültige News-ID.');
  }
  await markNewsAsRead(tenantId, newsId, employeeId);
}

export async function countEmployeeUnreadNews(tenantId: string, employeeId: number): Promise<number> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return 0;
  }
  return countUnreadNews(tenantId, employeeId);
}

export async function listEmployeeUnreadNews(tenantId: string, employeeId: number): Promise<EmployeeNewsItem[]> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return [];
  }
  return (await listUnreadNews(tenantId, employeeId)).map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    isRead: false,
    readAt: null,
  }));
}

export async function listEmployeeReadNews(tenantId: string, employeeId: number): Promise<EmployeeNewsItem[]> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return [];
  }
  return (await listReadNews(tenantId, employeeId)).map(mapEmployeeRow);
}
