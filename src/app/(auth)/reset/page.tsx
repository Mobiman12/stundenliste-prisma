import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import ResetPasswordForm from './ResetPasswordForm';

export const metadata = {
  title: 'Passwort zurücksetzen – Stundenliste',
};

type ResetSearchParams = {
  token?: string | string[];
  error?: string | string[];
};

const ERROR_MESSAGES: Record<string, string> = {
  missing: 'Bitte alle Felder ausfüllen.',
  weak:
    'Passwortregeln: mindestens 8 Zeichen, Groß-/Kleinbuchstabe, Zahl, Sonderzeichen, nur erlaubte Zeichen und identische Wiederholung.',
  mismatch: 'Die Passwörter stimmen nicht überein.',
  invalid: 'Der Reset-Link ist ungültig oder abgelaufen.',
};

export default async function ResetPage({
  searchParams,
}: {
  searchParams?: Promise<ResetSearchParams>;
}) {
  const session = await getServerAuthSession();
  if (session) {
    if (session.user.roleId === 2) {
      redirect(withAppBasePath('/admin'));
    }
    redirect(withAppBasePath('/mitarbeiter'));
  }

  const resolvedSearchParams = await searchParams;
  const tokenParam = Array.isArray(resolvedSearchParams?.token)
    ? resolvedSearchParams?.token[0]
    : resolvedSearchParams?.token;
  const errorKey = Array.isArray(resolvedSearchParams?.error)
    ? resolvedSearchParams?.error[0]
    : resolvedSearchParams?.error;
  const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] : null;

  if (!tokenParam) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand">Mitarbeiterportal</p>
            <h1 className="text-2xl font-semibold text-slate-900">Reset-Link fehlt</h1>
            <p className="text-sm text-slate-500">Bitte fordere einen neuen Link an.</p>
          </div>
          <div className="mt-6">
            <a
              href={withAppBasePath('/forgot?mode=employee', 'external')}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90"
            >
              Passwort vergessen
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-4 flex items-center justify-between text-sm">
          <a
            href={withAppBasePath('/login?mode=employee', 'external')}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-brand/40 hover:text-brand"
          >
            Zurück
          </a>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand">Mitarbeiterportal</p>
          <h1 className="text-2xl font-semibold text-slate-900">Neues Passwort setzen</h1>
          <p className="text-sm text-slate-500">Vergib ein neues Passwort für dein Konto.</p>
        </div>

        {errorMessage ? (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <ResetPasswordForm token={tokenParam} actionUrl={withAppBasePath('/auth/reset')} />
      </div>
    </div>
  );
}
