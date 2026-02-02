'use client';

import { withAppBasePath } from '@/lib/routes';

type SignOutButtonProps = {
  mode?: 'admin' | 'employee';
};

export function SignOutButton({ mode }: SignOutButtonProps) {
  const modeParam = mode === 'employee' ? 'employee' : 'admin';
  const href = withAppBasePath(`/api/auth/logout?mode=${modeParam}`, 'external');
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand/40 hover:text-brand"
    >
      <span aria-hidden>🔒</span>
      <span>Abmelden</span>
    </a>
  );
}
