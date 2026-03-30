import { headers } from 'next/headers';

import { getEmployeeOnboardingInviteByToken } from '@/lib/services/employee-onboarding';

import OnboardingForm from './OnboardingForm';

function statusCopy(status: 'used' | 'expired' | 'revoked' | 'invalid', usedAt?: Date | null) {
  if (status === 'used') {
    const submittedAtLabel = usedAt ? usedAt.toLocaleString('de-DE') : null;
    return {
      title: 'Personalbogen bereits übermittelt',
      text: submittedAtLabel
        ? `Dein Personalbogen wurde bereits erfolgreich am ${submittedAtLabel} übermittelt.`
        : 'Dein Personalbogen wurde bereits erfolgreich übermittelt.',
      tone: 'success' as const,
    };
  }
  if (status === 'expired') {
    return {
      title: 'Link abgelaufen',
      text: 'Der Einladungslink ist abgelaufen. Bitte fordere einen neuen Link beim Unternehmen an.',
      tone: 'error' as const,
    };
  }
  if (status === 'revoked') {
    return {
      title: 'Link widerrufen',
      text: 'Dieser Einladungslink wurde widerrufen. Bitte nutze den aktuellsten Link aus deiner E-Mail.',
      tone: 'error' as const,
    };
  }
  return {
    title: 'Ungültiger Link',
    text: 'Der Einladungslink ist ungültig oder unvollständig.',
    tone: 'error' as const,
  };
}

export default async function EmployeeOnboardingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const headersList = await headers();
  const tenantId = headersList.get('x-tenant-id')?.trim() || process.env.DEFAULT_TENANT_ID?.trim();

  if (!tenantId) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Tenant-Kontext fehlt. Bitte Link über die korrekte Tenant-Domain öffnen.
        </div>
      </main>
    );
  }

  const invite = await getEmployeeOnboardingInviteByToken(tenantId, token);

  if (invite.status !== 'open') {
    const copy = statusCopy(invite.status, invite.usedAt);
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <div
          className={`rounded-xl border p-6 shadow-sm ${
            copy.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-slate-200 bg-white'
          }`}
        >
          <h1 className="text-lg font-semibold text-slate-900">{copy.title}</h1>
          <p className="mt-2 text-sm text-slate-600">{copy.text}</p>
          {copy.tone === 'success' ? (
            <p className="mt-2 text-xs text-slate-500">
              Du kannst das Fenster jetzt schließen. Bei Rückfragen wende dich an dein Unternehmen.
            </p>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <OnboardingForm
        token={token}
        inviteEmail={invite.email ?? ''}
        inviteFirstName={invite.firstName}
        inviteLastName={invite.lastName}
        expiresAtLabel={invite.expiresAt ? invite.expiresAt.toLocaleString('de-DE') : 'unbekannt'}
        adminPreset={invite.adminPreset ?? null}
        tenantBranding={invite.tenantBranding ?? null}
      />
    </main>
  );
}
