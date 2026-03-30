import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { EmployeeIdleLogout } from '@/components/employee-idle-logout';
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
  { href: '/admin/urlaubsplan', label: 'Urlaubsplan' },
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
  const headersList = await headers();
  const host = headersList.get('host');
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
      <EmployeeIdleLogout mode="admin" />
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between sm:hidden">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-brand">{tenantName}</p>
              <h1 className="text-lg font-semibold text-slate-900">Admin-Backend</h1>
            </div>
            <details className="relative">
              <summary className="flex h-10 w-10 list-none items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm">
                <span className="sr-only">Menü öffnen</span>
                <span className="flex flex-col gap-1">
                  <span className="block h-0.5 w-4 bg-current" />
                  <span className="block h-0.5 w-4 bg-current" />
                  <span className="block h-0.5 w-4 bg-current" />
                </span>
              </summary>
              <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                <div className="border-b border-slate-100 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-900">{session.user.username}</p>
                  <p className="text-xs text-slate-500">Administrator</p>
                </div>
                <nav className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto py-2">
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
                        key={`mobile-${item.href}`}
                        href={item.href}
                        className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-brand"
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
                </nav>
                <div className="border-t border-slate-100 px-3 py-2">
                  <SignOutButton mode="admin" />
                </div>
              </div>
            </details>
          </div>
          <div className="hidden flex-col gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-brand">{tenantName}</p>
              <h1 className="text-lg font-semibold text-slate-900">Admin-Backend</h1>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
              <div className="text-left text-sm text-slate-600 sm:text-right">
                <p className="font-medium text-slate-800">{session.user.username}</p>
                <p>Administrator</p>
                <p className="text-xs text-slate-400">{tenantName}</p>
              </div>
              <SignOutButton mode="admin" />
            </div>
          </div>
        </div>
        <nav className="hidden border-t border-slate-200 bg-slate-50/60 sm:block">
          <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-2 py-2 text-sm sm:gap-4 sm:px-6">
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
                  className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1 text-slate-600 transition hover:bg-white hover:text-brand"
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
      <main className="mx-auto flex min-h-[calc(100vh-180px)] max-w-7xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
