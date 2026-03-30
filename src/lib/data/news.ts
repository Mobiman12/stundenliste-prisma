import { getPrisma } from '@/lib/prisma';

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

function toTimestamp(value: Date): string {
  return value.toISOString();
}

export async function listNews(tenantId: string): Promise<NewsRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.news.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      title: true,
      content: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    created_at: toTimestamp(row.createdAt),
  }));
}

export async function createNews(tenantId: string, title: string, content: string): Promise<number> {
  const prisma = getPrisma();
  const row = await prisma.news.create({
    data: {
      tenantId,
      title,
      content,
    },
    select: { id: true },
  });
  return row.id;
}

export async function deleteNewsById(tenantId: string, id: number): Promise<boolean> {
  const prisma = getPrisma();
  const result = await prisma.news.deleteMany({
    where: {
      tenantId,
      id,
    },
  });
  return result.count > 0;
}

export async function listNewsForEmployee(tenantId: string, employeeId: number): Promise<EmployeeNewsRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.news.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      title: true,
      content: true,
      createdAt: true,
      employeeNewsRead: {
        where: { employeeId },
        select: { readAt: true },
        take: 1,
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    created_at: toTimestamp(row.createdAt),
    is_read: row.employeeNewsRead.length > 0 ? 1 : 0,
    read_at: row.employeeNewsRead[0]?.readAt ? toTimestamp(row.employeeNewsRead[0].readAt) : null,
  }));
}

export async function markNewsAsRead(tenantId: string, newsId: number, employeeId: number): Promise<void> {
  const prisma = getPrisma();
  const news = await prisma.news.findFirst({
    where: {
      tenantId,
      id: newsId,
    },
    select: { id: true },
  });

  if (!news) {
    throw new Error('Ungültige News-ID.');
  }

  await prisma.employeeNewsRead.createMany({
    data: [{ employeeId, newsId }],
    skipDuplicates: true,
  });
}

export async function countUnreadNews(tenantId: string, employeeId: number): Promise<number> {
  const prisma = getPrisma();
  return prisma.news.count({
    where: {
      tenantId,
      employeeNewsRead: {
        none: { employeeId },
      },
    },
  });
}

export async function listUnreadNews(tenantId: string, employeeId: number): Promise<NewsRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.news.findMany({
    where: {
      tenantId,
      employeeNewsRead: {
        none: { employeeId },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      title: true,
      content: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    created_at: toTimestamp(row.createdAt),
  }));
}

export async function listReadNews(tenantId: string, employeeId: number): Promise<EmployeeNewsRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.employeeNewsRead.findMany({
    where: {
      employeeId,
      news: {
        tenantId,
      },
    },
    orderBy: [{ readAt: 'desc' }, { newsId: 'desc' }],
    select: {
      readAt: true,
      news: {
        select: {
          id: true,
          title: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.news.id,
    title: row.news.title,
    content: row.news.content,
    created_at: toTimestamp(row.news.createdAt),
    is_read: 1,
    read_at: toTimestamp(row.readAt),
  }));
}
