import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { DateTime } from 'luxon';

import { EmployeeIdleLogout } from '@/components/employee-idle-logout';
import { SignOutButton } from '@/components/sign-out-button';
import { getServerAuthSession } from '@/lib/auth/session';
import { fetchStaffShiftPlanSettings } from '@/lib/control-plane';
import { getEmployeeById } from '@/lib/data/employees';
import { countShiftPlanDays } from '@/lib/data/shift-plan-days';
import { withAppBasePath } from '@/lib/routes';
import { countEmployeeUnreadNews } from '@/lib/services/news';
import { completeEmployeeInitialBookingPin } from '@/lib/services/employee/profile';

import { InitialBookingPinModal } from './InitialBookingPinModal';
import { MissingShiftPlanPopup } from './MissingShiftPlanPopup';

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

type MissingShiftPlanInfo = {
  monthKey: string;
  monthLabel: string;
};

function normalizeMonthLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

async function isCentralShiftPlanEnabled(tenantSlug: string | null | undefined): Promise<boolean> {
  // "Schichtplan (zentral)" lives in the Control-Plane tenant dashboard.
  // Today it is enabled when the Timesheet app instance is enabled for the tenant.
  // We validate that by resolving the tenant/app via the Control-Plane resolver.
  const slug = (tenantSlug ?? '').trim();
  if (!slug) {
    // Backwards compatibility (dev/single-tenant setups).
    return true;
  }

  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  if (!baseUrl) {
    return true;
  }

  try {
    const url = new URL('/api/internal/tenant/resolve', baseUrl);
    url.searchParams.set('tenant', slug);
    url.searchParams.set('app', 'timeshift');
    const response = await fetch(url, { cache: 'no-store' });
    return response.ok;
  } catch (error) {
    console.warn('[shift-plan] failed to resolve tenant/app', error);
    return true;
  }
}

async function getMissingShiftPlanInfo(employeeId: number): Promise<MissingShiftPlanInfo | null> {
  const now = DateTime.now().setZone('Europe/Berlin');
  const candidates = [now.startOf('month'), now.plus({ months: 1 }).startOf('month')];

  for (const monthStart of candidates) {
    const start = monthStart.toFormat('yyyy-LL-01');
    const end = monthStart.endOf('month').toFormat('yyyy-LL-dd');
    const count = await countShiftPlanDays(employeeId, start, end);
    if (count <= 0) {
      const label = monthStart.setLocale('de').toFormat('LLLL yyyy');
      return {
        monthKey: monthStart.toFormat('yyyy-LL'),
        monthLabel: normalizeMonthLabel(label),
      };
    }
  }

  return null;
}

export default async function MitarbeiterLayout({ children }: { children: ReactNode }) {
  const session = await getServerAuthSession();

  if (!session) {
    redirect(withAppBasePath('/login?mode=employee'));
  }

  if (session.user.roleId === 2) {
    redirect(withAppBasePath('/admin'));
  }

  async function completeInitialBookingPinAction(
    _prevState: { status: 'success' | 'error'; message: string } | null,
    formData: FormData
  ): Promise<{ status: 'success' | 'error'; message: string } | null> {
    'use server';

    const activeSession = await getServerAuthSession();
    if (!activeSession?.user?.employeeId) {
      return { status: 'error', message: 'Sitzung abgelaufen. Bitte neu anmelden.' };
    }

    const onboardingStatus = (activeSession.user.onboardingStatus ?? '').trim().toLowerCase();
    if (onboardingStatus !== 'pin_setup_required') {
      return { status: 'success', message: 'Buchungs-PIN ist bereits eingerichtet.' };
    }

    const newPin = String(formData.get('new_pin') ?? '').trim();
    const confirmPin = String(formData.get('confirm_pin') ?? '').trim();
    if (!/^\d{4}$/.test(newPin) || !/^\d{4}$/.test(confirmPin)) {
      return { status: 'error', message: 'Die Buchungs-PIN muss aus genau 4 Ziffern bestehen.' };
    }
    if (newPin !== confirmPin) {
      return { status: 'error', message: 'Die PIN stimmt nicht mit der Wiederholung überein.' };
    }

    const result = await completeEmployeeInitialBookingPin(
      activeSession.user.employeeId,
      newPin,
      activeSession.tenantId ?? null
    );
    if (!result.success) {
      return { status: 'error', message: result.message ?? 'Buchungs-PIN konnte nicht gespeichert werden.' };
    }

    revalidatePath(withAppBasePath('/mitarbeiter'), 'layout');
    revalidatePath(withAppBasePath('/mitarbeiter/profil'));
    return { status: 'success', message: 'Buchungs-PIN wurde gespeichert.' };
  }

  const greetingName = session.user.firstName ?? session.user.username;
  const employeeId = session.user.employeeId ?? null;
  const unreadNews = employeeId && session.tenantId ? await countEmployeeUnreadNews(session.tenantId, employeeId) : 0;
  const sessionTenant =
    typeof session.raw.tenantName === 'string'
      ? session.raw.tenantName
      : typeof session.raw.tenantSlug === 'string'
        ? session.raw.tenantSlug
        : null;
  const tenantName = sessionTenant ?? process.env.TENANT_NAME ?? 'murmel creation';
  const calendarHref = withAppBasePath('/mitarbeiter/calendar', 'external');
  const navItems = [NAV_ITEMS[0], { href: calendarHref, label: 'Kalender', newTab: true }, ...NAV_ITEMS.slice(1)];
  const requiresInitialPinSetup = (session.user.onboardingStatus ?? '').trim().toLowerCase() === 'pin_setup_required';

  const shiftPlanHref = withAppBasePath('/mitarbeiter/schichtplan');
  let missingShiftPlan: MissingShiftPlanInfo | null = null;
  let allowEmployeeSelfPlan = false;

  if (employeeId && session.tenantId) {
    try {
      const tenantSlug = typeof session.raw.tenantSlug === 'string' ? session.raw.tenantSlug : null;
      missingShiftPlan = await getMissingShiftPlanInfo(employeeId);
      if (missingShiftPlan) {
        const centralShiftPlanEnabled = await isCentralShiftPlanEnabled(tenantSlug);
        if (!centralShiftPlanEnabled) {
          missingShiftPlan = null;
        }
      }

      if (missingShiftPlan) {
        const employee = await getEmployeeById(session.tenantId, employeeId);
        if (employee) {
          const staffId = employee.control_plane_staff_id ?? employee.personnel_number ?? null;
          const settings = await fetchStaffShiftPlanSettings({
            tenantId: session.tenantId,
            staffId,
            email: employee.email ?? employee.username ?? null,
            firstName: employee.first_name ?? null,
            lastName: employee.last_name ?? null,
            displayName: `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim() || null,
          });
          allowEmployeeSelfPlan = settings.allowEmployeeSelfPlan === true;
        }
      }
    } catch (error) {
      console.warn('[shift-plan] missing-month popup check failed', error);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <EmployeeIdleLogout />
      {requiresInitialPinSetup ? <InitialBookingPinModal action={completeInitialBookingPinAction} /> : null}
      {missingShiftPlan ? (
        <MissingShiftPlanPopup
          missingMonthKey={missingShiftPlan.monthKey}
          // Scope dismissal per tenant+employee. We intentionally do NOT include rolling session timestamps
          // (like expiresAt) because those may change on refresh and would re-open the popup right after
          // the employee saves their shift plan (router.refresh triggers a new render).
          dismissScopeKey={`${session.tenantId}:${employeeId}`}
          missingMonthLabel={missingShiftPlan.monthLabel}
          shiftPlanHref={shiftPlanHref}
          allowEmployeeSelfPlan={allowEmployeeSelfPlan}
        />
      ) : null}
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between sm:hidden">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-brand">{tenantName}</p>
              <h1 className="text-lg font-semibold text-slate-900">Mitarbeiterportal</h1>
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
                  <p className="text-sm font-semibold text-slate-900">{greetingName}</p>
                  <p className="text-xs text-slate-500">Mitarbeiterkonto</p>
                </div>
                <nav className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto py-2">
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
                    return (
                      <a
                        key={`mobile-${item.href}`}
                        href={item.href}
                        target={isExternal || openInNewTab ? '_blank' : undefined}
                        rel={isExternal || openInNewTab ? 'noreferrer' : undefined}
                        className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-brand"
                      >
                        {content}
                      </a>
                    );
                  })}
                </nav>
                <div className="border-t border-slate-100 px-3 py-2">
                  <SignOutButton mode="employee" />
                </div>
              </div>
            </details>
          </div>
          <div className="hidden flex-col gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-brand">{tenantName}</p>
              <h1 className="text-lg font-semibold text-slate-900">Mitarbeiterportal</h1>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
              <div className="text-left text-sm text-slate-600 sm:text-right">
                <p className="font-medium text-slate-800">{greetingName}</p>
                <p>Mitarbeiterkonto</p>
                <p className="text-xs text-slate-400">{tenantName}</p>
              </div>
              <SignOutButton mode="employee" />
            </div>
          </div>
        </div>
        <nav className="hidden border-t border-slate-200 bg-slate-50/60 sm:block">
          <div className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto px-2 py-2 text-sm sm:gap-3 sm:px-6">
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
                    className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1 text-slate-600 transition hover:bg-white hover:text-brand"
                  >
                    {content}
                  </a>
                );
              }
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1 text-slate-600 transition hover:bg-white hover:text-brand"
                >
                  {content}
                </a>
              );
            })}
          </div>
        </nav>
      </header>
      <main className="mx-auto flex min-h-[calc(100vh-180px)] max-w-6xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
