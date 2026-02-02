import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import { listAdminNews, createAdminNews, deleteAdminNews } from '@/lib/services/news';

import AdminNewsForm from './AdminNewsForm';

export type NewsFormState = {
  status?: 'success' | 'error';
  message?: string;
};

export type DeleteState = {
  status: 'success' | 'error';
  message?: string;
};

const INITIAL_FORM_STATE: NewsFormState = {};

function ensureAdmin(session: Awaited<ReturnType<typeof getServerAuthSession>>) {
  if (!session?.user) {
    redirect(withAppBasePath('/login'));
  }
  if (session.user.roleId !== 2) {
    redirect(withAppBasePath('/mitarbeiter'));
  }
}

async function createNewsAction(
  prevState: NewsFormState,
  formData: FormData
): Promise<NewsFormState> {
  'use server';

  const session = await getServerAuthSession();
  ensureAdmin(session);

  const title = String(formData.get('title') ?? '');
  const content = String(formData.get('content') ?? '');

  try {
    await Promise.resolve(createAdminNews({ title, content }));
    revalidatePath(withAppBasePath('/admin/news'));
    return {
      status: 'success',
      message: 'Neuigkeit gespeichert.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Speichern fehlgeschlagen.';
    return {
      status: 'error',
      message,
    };
  }
}

async function deleteNewsAction(formData: FormData): Promise<DeleteState> {
  'use server';

  const session = await getServerAuthSession();
  ensureAdmin(session);

  const idRaw = formData.get('newsId');
  const id = Number.parseInt(String(idRaw ?? ''), 10);

  if (!Number.isFinite(id) || id <= 0) {
    return {
      status: 'error',
      message: 'Ungültige News-ID.',
    };
  }

  try {
    const deleted = deleteAdminNews(id);
    if (!deleted) {
      return {
        status: 'error',
        message: 'Neuigkeit nicht gefunden oder bereits gelöscht.',
      };
    }
    revalidatePath(withAppBasePath('/admin/news'));
    return {
      status: 'success',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Löschen fehlgeschlagen.';
    return {
      status: 'error',
      message,
    };
  }
}

export default async function AdminNewsPage() {
  const session = await getServerAuthSession();
  ensureAdmin(session);

  const news = listAdminNews();

  return (
    <AdminNewsForm
      news={news}
      createAction={createNewsAction}
      createInitialState={INITIAL_FORM_STATE}
      deleteAction={deleteNewsAction}
    />
  );
}
