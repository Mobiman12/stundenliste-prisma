import { redirect } from 'next/navigation';
import type React from 'react';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';

const DEV_FALLBACK_USER = process.env.NEXT_PUBLIC_DEV_USER ?? 'Admin';
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:3003';
const CONTROL_PLANE_PUBLIC_URL = process.env.CONTROL_PLANE_PUBLIC_URL ?? CONTROL_PLANE_URL;

const ERROR_MESSAGES: Record<string, string> = {
  invalid: 'Benutzername oder Passwort ist falsch.',
  missing: 'Bitte Benutzername und Passwort eingeben.',
  inactive: 'Dein Zugang wurde deaktiviert. Bitte wende dich an den Admin.',
  locked: 'Zugang ist temporaer gesperrt.',
};

export const metadata = {
  title: 'Mitarbeiter-Login – Timevex Timesheet',
};

function warnMessage(hint: string | null, remaining: number | null): React.ReactNode | null {
  if (!hint?.startsWith('warn_')) return null;
  if (!Number.isFinite(remaining) || (remaining ?? 0) < 0) return null;
  const left = Math.max(0, Math.floor(remaining ?? 0));
  if (left <= 0) return null;
  const unit = left === 1 ? 'Versuch' : 'Versuche';
  if (hint === 'warn_lock_10m') {
    return `Noch ${left} ${unit}, dann wird der Zugang für 10 Minuten gesperrt.`;
  }
  if (hint === 'warn_lock_24h') {
    return `Noch ${left} ${unit}, dann wird der Zugang für 24h gesperrt.`;
  }
  return 'Achtung: Bei weiteren Fehlversuchen wird der Zugang gesperrt.';
}

type LoginSearchParams = {
  mode?: string | string[];
  error?: string | string[];
  hint?: string | string[];
  retry?: string | string[];
  remaining?: string | string[];
  redirect?: string | string[];
  loggedOut?: string | string[];
  force?: string | string[];
  reset?: string | string[];
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<LoginSearchParams>;
}) {
  const session = await getServerAuthSession();
  if (session) {
    if (session.user.roleId === 2) {
      redirect(withAppBasePath('/admin'));
    }
    redirect(withAppBasePath('/mitarbeiter'));
  }

  const resolvedSearchParams = await searchParams;
  const mode = Array.isArray(resolvedSearchParams?.mode) ? resolvedSearchParams?.mode[0] : resolvedSearchParams?.mode;
  const resetParam = Array.isArray(resolvedSearchParams?.reset)
    ? resolvedSearchParams?.reset[0]
    : resolvedSearchParams?.reset;
  if (mode === 'employee') {
    const errorKey = Array.isArray(resolvedSearchParams?.error)
      ? resolvedSearchParams?.error[0]
      : resolvedSearchParams?.error;
    const hintKey = Array.isArray(resolvedSearchParams?.hint)
      ? resolvedSearchParams?.hint[0]
      : resolvedSearchParams?.hint;
    const retryParam = Array.isArray(resolvedSearchParams?.retry)
      ? resolvedSearchParams?.retry[0]
      : resolvedSearchParams?.retry;
    const remainingParam = Array.isArray(resolvedSearchParams?.remaining)
      ? resolvedSearchParams?.remaining[0]
      : resolvedSearchParams?.remaining;
    const retrySeconds = retryParam ? Number(retryParam) : NaN;
    const remainingAttempts = remainingParam ? Number(remainingParam) : NaN;
    const retryMinutes = Number.isFinite(retrySeconds) && retrySeconds > 0 ? Math.ceil(retrySeconds / 60) : null;
    const remaining = Number.isFinite(remainingAttempts) && remainingAttempts >= 0 ? remainingAttempts : null;

    let errorMessage: React.ReactNode | null = errorKey ? ERROR_MESSAGES[errorKey] : null;
    if (errorKey === 'locked') {
      if (retryMinutes) {
        errorMessage = `Zugang temporaer gesperrt. Bitte in ca. ${retryMinutes} Minuten erneut versuchen.`;
      } else {
        errorMessage = 'Zugang temporaer gesperrt. Bitte spaeter erneut versuchen.';
      }
    }
    const resetMessage =
      resetParam ? 'Dein Passwort wurde aktualisiert. Bitte melde dich neu an.' : null;
    const redirectTarget =
      (Array.isArray(resolvedSearchParams?.redirect)
        ? resolvedSearchParams?.redirect[0]
        : resolvedSearchParams?.redirect) ?? '/mitarbeiter';

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
          <div className="flex justify-center">
            <img
              src="/branding/timevex-logo.png"
              alt="Timevex"
              className="h-10 w-auto"
              draggable={false}
            />
          </div>
          <div className="mt-4 space-y-2 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand">Timesheet</p>
            <h1 className="text-2xl font-semibold text-slate-900">Mitarbeiter-Login</h1>
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

          {hintKey && hintKey.startsWith('warn_') ? (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {warnMessage(hintKey, remaining)}
            </div>
          ) : null}

          <form method="post" action={withAppBasePath('/auth/login')} className="mt-6 space-y-4" autoComplete="off">
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
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
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
                autoComplete="new-password"
                autoCorrect="off"
                spellCheck={false}
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

  if (process.env.NODE_ENV !== 'production') {
    if (CONTROL_PLANE_PUBLIC_URL) {
      const ssoUrl = new URL('/tenant/sso', CONTROL_PLANE_PUBLIC_URL);
      ssoUrl.searchParams.set('app', 'TIMESHIFT');
      ssoUrl.searchParams.set('redirect', withAppBasePath('/admin', 'external'));
      redirect(ssoUrl.toString());
    }

    const devSessionUrl = withAppBasePath(`/api/dev-session?user=${encodeURIComponent(DEV_FALLBACK_USER)}`, 'router');
    redirect(devSessionUrl);
  }

  // Timesheet has a single login surface for employees. Admin access is handled via Control-Plane SSO.
  redirect(withAppBasePath('/login?mode=employee'));
}
