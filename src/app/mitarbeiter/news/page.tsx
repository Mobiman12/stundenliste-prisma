import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import { listEmployeeNews, markEmployeeNewsAsRead } from '@/lib/services/news';

import EmployeeNewsList from './EmployeeNewsList';

export type MarkState = {
  status: 'success' | 'error';
  message?: string;
};

function ensureEmployee(session: Awaited<ReturnType<typeof getServerAuthSession>>): number {
  if (!session?.user) {
    redirect(withAppBasePath('/login?mode=employee'));
  }
  if (!session.user.employeeId) {
    redirect(withAppBasePath('/admin'));
  }
  return session.user.employeeId;
}

async function markNewsReadAction(formData: FormData): Promise<MarkState> {
  'use server';

  const session = await getServerAuthSession();
  const employeeId = ensureEmployee(session);

  const idRaw = formData.get('newsId');
  const newsId = Number.parseInt(String(idRaw ?? ''), 10);

  if (!Number.isFinite(newsId) || newsId <= 0) {
    return {
      status: 'error',
      message: 'Ungültige News-ID.',
    };
  }

  try {
    markEmployeeNewsAsRead(employeeId, newsId);
    revalidatePath(withAppBasePath('/mitarbeiter/news'));
    return {
      status: 'success',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Markierung fehlgeschlagen.';
    return {
      status: 'error',
      message,
    };
  }
}

export default async function MitarbeiterNewsPage() {
  const session = await getServerAuthSession();
  const employeeId = ensureEmployee(session);

  const news = listEmployeeNews(employeeId);

  return <EmployeeNewsList news={news} markAsReadAction={markNewsReadAction} />;
}
