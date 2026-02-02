import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SignOutButton } from '@/components/sign-out-button';
import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import { countUnseenEmployeeDocuments } from '@/lib/services/documents';
import { countPendingLeaveRequests } from '@/lib/services/leave-requests';

const NAV_ITEMS = [
  { href: '/admin', label: 'Übersicht' },
  { href: '/admin/mitarbeitende', label: 'Mitarbeiter' },
  { href: '/admin/dokumente', label: 'Dokumente' },
  { href: '/admin/monatsabschluss', label: 'Monatsabschluss' },
  { href: '/admin/antraege', label: 'Anträge' },
  { href: '/admin/news', label: 'News' },
  { href: '/admin/erinnerungen', label: 'Erinnerungen' },
];

function resolveTenantLabel(host: string | null): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0] ?? host;
  const parts = hostname.split('.');
  if (parts.length < 3) return null;
  const tenantSlug = (parts[0] ?? '').trim();
  return tenantSlug.length ? tenantSlug : null;
}

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getServerAuthSession();

  if (!session) {
    redirect(withAppBasePath('/login'));
  }

  if (session.user.roleId !== 2) {
    redirect(withAppBasePath('/mitarbeiter'));
  }

  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login'));
  }

  const unseenDocuments = await countUnseenEmployeeDocuments(tenantId, session.user.id);
  const pendingRequests = await countPendingLeaveRequests(tenantId);
  const host = headers().get('host');
  const tenantLabel = resolveTenantLabel(host);
  const sessionTenant =
    typeof session.raw.tenantName === 'string'
      ? session.raw.tenantName
      : typeof session.raw.tenantSlug === 'string'
        ? session.raw.tenantSlug
        : null;
  const tenantName = sessionTenant ?? tenantLabel ?? process.env.TENANT_NAME ?? 'murmel creation';

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-brand">{tenantName}</p>
            <h1 className="text-lg font-semibold text-slate-900">Admin-Backend</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-sm text-slate-600">
              <p className="font-medium text-slate-800">{session.user.username}</p>
              <p>Administrator</p>
              <p className="text-xs text-slate-400">{tenantName}</p>
            </div>
            <SignOutButton mode="admin" />
          </div>
        </div>
        <nav className="border-t border-slate-200 bg-slate-50/60">
          <div className="mx-auto flex max-w-7xl items-center gap-4 overflow-x-auto px-6 py-2 text-sm">
            {NAV_ITEMS.map((item) => {
              const badgeCount =
                item.href === '/admin/dokumente'
                  ? unseenDocuments
                  : item.href === '/admin/antraege'
                  ? pendingRequests
                  : 0;
              const showBadge = badgeCount > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex items-center gap-2 rounded-md px-3 py-1 text-slate-600 transition hover:bg-white hover:text-brand"
                >
                  <span>{item.label}</span>
                  {showBadge ? (
                    <span className="min-w-[1.5rem] rounded-full bg-brand px-2 py-0.5 text-center text-xs font-semibold text-white">
                      {badgeCount}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>
      <main className="mx-auto flex min-h-[calc(100vh-160px)] max-w-7xl flex-col gap-8 px-6 py-10">
        {children}
      </main>
    </div>
  );
}
