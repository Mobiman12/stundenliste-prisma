import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';

export default async function Home() {
  const session = await getServerAuthSession();
  if (!session) {
    redirect(withAppBasePath('/login'));
  }

  redirect(withAppBasePath('/dashboard'));
}
