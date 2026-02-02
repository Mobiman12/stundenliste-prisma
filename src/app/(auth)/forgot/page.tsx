import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';

export const metadata = {
  title: 'Passwort vergessen – Stundenliste',
};

type ForgotSearchParams = {
  sent?: string | string[];
  error?: string | string[];
  mode?: string | string[];
};

const ERROR_MESSAGES: Record<string, string> = {
  missing: 'Bitte eine E-Mail-Adresse angeben.',
};

export default async function ForgotPage({ searchParams }: { searchParams?: ForgotSearchParams }) {
  const session = await getServerAuthSession();
  if (session) {
    if (session.user.roleId === 2) {
      redirect(withAppBasePath('/admin'));
    }
    redirect(withAppBasePath('/mitarbeiter'));
  }

  const sentParam = Array.isArray(searchParams?.sent) ? searchParams?.sent[0] : searchParams?.sent;
  const errorKey = Array.isArray(searchParams?.error) ? searchParams?.error[0] : searchParams?.error;
  const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] : null;
  const sentMessage = sentParam
    ? 'Wenn ein Konto mit dieser E-Mail existiert, wurde eine Nachricht mit dem Reset-Link gesendet.'
    : null;

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
          <h1 className="text-2xl font-semibold text-slate-900">Passwort vergessen</h1>
          <p className="text-sm text-slate-500">
            Gib die E-Mail-Adresse deines Kontos ein. Du erhältst einen Link zum Zurücksetzen.
          </p>
        </div>

        {sentMessage ? (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {sentMessage}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <form method="post" action={withAppBasePath('/auth/request-reset')} className="mt-6 space-y-4">
          <input type="hidden" name="mode" value="employee" />
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-slate-700">
              E-Mail-Adresse
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90"
          >
            Link senden
          </button>
        </form>
      </div>
    </div>
  );
}
