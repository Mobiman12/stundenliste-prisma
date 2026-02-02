import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';

const TEAM_LOGIN_URL = process.env.NEXT_PUBLIC_TEAM_LOGIN_URL ?? 'https://murmel-creation.de/team/login';
const DEV_FALLBACK_USER = process.env.NEXT_PUBLIC_DEV_USER ?? 'Admin';
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:3003';

const ERROR_MESSAGES: Record<string, string> = {
  invalid: 'Benutzername oder Passwort ist falsch.',
  missing: 'Bitte Benutzername und Passwort eingeben.',
  inactive: 'Dieses Mitarbeiterkonto ist deaktiviert.',
};

export const metadata = {
  title: 'Anmelden – Stundenliste',
};

type LoginSearchParams = {
  mode?: string | string[];
  error?: string | string[];
  redirect?: string | string[];
  loggedOut?: string | string[];
  force?: string | string[];
};

export default async function LoginPage({ searchParams }: { searchParams?: LoginSearchParams }) {
  const session = await getServerAuthSession();
  if (session) {
    if (session.user.roleId === 2) {
      redirect(withAppBasePath('/admin'));
    }
    redirect(withAppBasePath('/mitarbeiter'));
  }

  const mode = Array.isArray(searchParams?.mode) ? searchParams?.mode[0] : searchParams?.mode;
  const forceParam = Array.isArray(searchParams?.force) ? searchParams?.force[0] : searchParams?.force;
  const loggedOutParam = Array.isArray(searchParams?.loggedOut) ? searchParams?.loggedOut[0] : searchParams?.loggedOut;
  const resetParam = Array.isArray(searchParams?.reset) ? searchParams?.reset[0] : searchParams?.reset;
  const forceLogin = Boolean((forceParam ?? '').trim() || (loggedOutParam ?? '').trim());
  if (mode === 'employee') {
    const errorKey = Array.isArray(searchParams?.error) ? searchParams?.error[0] : searchParams?.error;
    const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] : null;
    const resetMessage =
      resetParam ? 'Dein Passwort wurde aktualisiert. Bitte melde dich neu an.' : null;
    const redirectTarget =
      (Array.isArray(searchParams?.redirect) ? searchParams?.redirect[0] : searchParams?.redirect) ?? '/mitarbeiter';

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
          <div className="mb-4 flex items-center justify-between text-sm">
            <a
              href={withAppBasePath('/login?loggedOut=1', 'external')}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-brand/40 hover:text-brand"
            >
              Zurück
            </a>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand">Mitarbeiterportal</p>
            <h1 className="text-2xl font-semibold text-slate-900">Anmelden</h1>
            <p className="text-sm text-slate-500">Bitte mit Benutzername (E-Mail) und Passwort einloggen.</p>
          </div>

          {resetMessage ? (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {resetMessage}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          ) : null}

          <form method="post" action={withAppBasePath('/auth/login')} className="mt-6 space-y-4">
            <input type="hidden" name="mode" value="employee" />
            <input type="hidden" name="redirect" value={redirectTarget} />
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium text-slate-700">
                Benutzername (E-Mail)
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-slate-700">
                Passwort
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                required
              />
            </div>
            <div className="text-right">
              <a
                href={withAppBasePath('/forgot?mode=employee', 'external')}
                className="text-xs font-semibold text-slate-500 transition hover:text-brand"
              >
                Passwort vergessen?
              </a>
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90"
            >
              Anmelden
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (forceLogin) {
    const ssoTarget = CONTROL_PLANE_URL
      ? (() => {
          const url = new URL('/tenant/sso', CONTROL_PLANE_URL);
          url.searchParams.set('app', 'TIMESHIFT');
          url.searchParams.set('redirect', withAppBasePath('/admin', 'external'));
          return url.toString();
        })()
      : null;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand">Stundenliste</p>
            <h1 className="text-2xl font-semibold text-slate-900">Abgemeldet</h1>
            <p className="text-sm text-slate-500">Du kannst dich nun erneut anmelden.</p>
          </div>
          <div className="mt-6 grid gap-3">
            {ssoTarget ? (
              <a
                href={ssoTarget}
                className="rounded-lg bg-brand px-4 py-2 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90"
              >
                Admin Login
              </a>
            ) : null}
            <a
              href={withAppBasePath('/login?mode=employee', 'external')}
              className="rounded-lg border border-slate-200 px-4 py-2 text-center text-sm font-semibold text-slate-700 shadow-sm transition hover:border-brand/40 hover:text-brand"
            >
              Mitarbeiter Login
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    if (CONTROL_PLANE_URL) {
      const ssoUrl = new URL('/tenant/sso', CONTROL_PLANE_URL);
      ssoUrl.searchParams.set('app', 'TIMESHIFT');
      ssoUrl.searchParams.set('redirect', withAppBasePath('/admin', 'external'));
      redirect(ssoUrl.toString());
    }

    const devSessionUrl = withAppBasePath(`/api/dev-session?user=${encodeURIComponent(DEV_FALLBACK_USER)}`, 'router');
    redirect(devSessionUrl);
  }

  redirect(TEAM_LOGIN_URL);
}
