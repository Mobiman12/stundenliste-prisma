import { redirect } from 'next/navigation';

import { withAppBasePath } from '@/lib/routes';

export default async function Home() {
  redirect(withAppBasePath('/login?mode=employee'));
}
