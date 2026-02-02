import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';

export default async function DashboardRedirectPage() {
  const session = await getServerAuthSession();

  if (!session) {
    redirect(withAppBasePath('/login'));
  }

  if (session.user.roleId === 2) {
    redirect(withAppBasePath('/admin'));
  }

  redirect(withAppBasePath('/mitarbeiter'));
}
