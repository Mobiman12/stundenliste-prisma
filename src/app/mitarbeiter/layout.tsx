import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { EmployeeIdleLogout } from '@/components/employee-idle-logout';
import { SignOutButton } from '@/components/sign-out-button';
import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import { countEmployeeUnreadNews } from '@/lib/services/news';

type NavItem = {
  href: string;
  label: string;
  newTab?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/mitarbeiter', label: 'Tageserfassung' },
  { href: '/mitarbeiter/schichtplan', label: 'Schichtplan' },
  { href: '/mitarbeiter/antraege', label: 'Anträge' },
  { href: '/mitarbeiter/monatsuebersicht', label: 'Monatsübersicht' },
  { href: '/mitarbeiter/umsatz', label: 'Umsatzübersicht' },
  { href: '/mitarbeiter/dokumente', label: 'Dokumente' },
  { href: '/mitarbeiter/statistik', label: 'Statistik' },
  { href: '/mitarbeiter/profil', label: 'Profil' },
  { href: '/mitarbeiter/news', label: 'Neuigkeiten' },
];

export default async function MitarbeiterLayout({ children }: { children: ReactNode }) {
  const session = await getServerAuthSession();

  if (!session) {
    redirect(withAppBasePath('/login?mode=employee'));
  }

  if (session.user.roleId === 2) {
    redirect(withAppBasePath('/admin'));
  }

  const greetingName = session.user.firstName ?? session.user.username;
  const employeeId = session.user.employeeId ?? null;
  const unreadNews = employeeId ? countEmployeeUnreadNews(employeeId) : 0;
  const sessionTenant =
    typeof session.raw.tenantName === 'string'
      ? session.raw.tenantName
      : typeof session.raw.tenantSlug === 'string'
        ? session.raw.tenantSlug
        : null;
  const tenantName = sessionTenant ?? process.env.TENANT_NAME ?? 'murmel creation';
  const calendarHref = withAppBasePath('/mitarbeiter/calendar', 'external');
  const navItems = [NAV_ITEMS[0], { href: calendarHref, label: 'Kalender', newTab: true }, ...NAV_ITEMS.slice(1)];

  return (
    <div className="min-h-screen bg-slate-100">
      <EmployeeIdleLogout />
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-brand">{tenantName}</p>
            <h1 className="text-lg font-semibold text-slate-900">Mitarbeiterportal</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-sm text-slate-600">
              <p className="font-medium text-slate-800">{greetingName}</p>
              <p>Mitarbeiterkonto</p>
              <p className="text-xs text-slate-400">{tenantName}</p>
            </div>
            <SignOutButton mode="employee" />
          </div>
        </div>
        <nav className="border-t border-slate-200 bg-slate-50/60">
          <div className="mx-auto flex max-w-6xl items-center gap-3 overflow-x-auto px-6 py-2 text-sm">
            {navItems.map((item) => {
              const showBadge = item.href === '/mitarbeiter/news' && unreadNews > 0;
              const isExternal = /^https?:\/\//.test(item.href);
              const openInNewTab = item.newTab === true;
              const content = (
                <>
                  <span>{item.label}</span>
                  {showBadge ? (
                    <span className="flex h-5 min-w-[1.5rem] items-center justify-center rounded-full bg-brand px-2 text-xs font-semibold text-white">
                      {unreadNews}
                    </span>
                  ) : null}
                </>
              );
              if (isExternal || openInNewTab) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    target={openInNewTab ? '_blank' : undefined}
                    rel={openInNewTab ? 'noreferrer' : undefined}
                    className="flex items-center gap-2 rounded-md px-3 py-1 text-slate-600 transition hover:bg-white hover:text-brand"
                  >
                    {content}
                  </a>
                );
              }
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2 rounded-md px-3 py-1 text-slate-600 transition hover:bg-white hover:text-brand"
                >
                  {content}
                </a>
              );
            })}
          </div>
        </nav>
      </header>
      <main className="mx-auto flex min-h-[calc(100vh-160px)] max-w-6xl flex-col gap-8 px-6 py-10">
        {children}
      </main>
    </div>
  );
}
