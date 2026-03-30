'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { EmployeeListItem } from '@/lib/services/admin/employee';
import type { ActionState } from './[employeeId]/types';

function SmallButton({ label, tone }: { label: string; tone: 'danger' | 'success' }) {
  const { pending } = useFormStatus();
  const base =
    tone === 'danger'
      ? 'border-red-200 text-red-600 hover:bg-red-50'
      : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50';
  return (
    <button
      type="submit"
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${base}`}
      disabled={pending}
    >
      {pending ? `${label}…` : label}
    </button>
  );
}

type Props = {
  activeEmployees: EmployeeListItem[];
  inactiveEmployees: EmployeeListItem[];
  onboardingInvites: {
    id: number;
    email: string;
    firstName: string | null;
    lastName: string | null;
    createdAtLabel: string;
    expiresAtLabel: string;
    usedAtLabel: string | null;
    status: 'open' | 'used' | 'expired' | 'revoked' | 'invalid';
    employeeDisplayName: string | null;
  }[];
  toggleAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  toggleInitialState: ActionState;
  inviteAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  inviteInitialState: ActionState;
  deleteInviteAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  deleteInviteInitialState: ActionState;
};

export default function AdminEmployeeListClient({
  activeEmployees,
  inactiveEmployees,
  onboardingInvites,
  toggleAction,
  toggleInitialState,
  inviteAction,
  inviteInitialState,
  deleteInviteAction,
  deleteInviteInitialState,
}: Props) {
  const router = useRouter();
  const [toggleState, toggleFormAction] = useActionState(toggleAction, toggleInitialState);
  const [inviteState, inviteFormAction] = useActionState(inviteAction, inviteInitialState);
  const [deleteInviteState, deleteInviteFormAction] = useActionState(
    deleteInviteAction,
    deleteInviteInitialState
  );
  const [inviteCompensationType, setInviteCompensationType] = useState<'hourly' | 'fixed'>('hourly');
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const inviteRefreshTriggeredRef = useRef(false);
  const deleteInviteRefreshTriggeredRef = useRef(false);

  useEffect(() => {
    if (inviteState?.status === 'success') {
      setInviteFormOpen(false);
      if (!inviteRefreshTriggeredRef.current) {
        inviteRefreshTriggeredRef.current = true;
        router.refresh();
      }
      return;
    }
    inviteRefreshTriggeredRef.current = false;
  }, [inviteState?.status, router]);

  useEffect(() => {
    if (deleteInviteState?.status === 'success') {
      if (!deleteInviteRefreshTriggeredRef.current) {
        deleteInviteRefreshTriggeredRef.current = true;
        router.refresh();
      }
      return;
    }
    deleteInviteRefreshTriggeredRef.current = false;
  }, [deleteInviteState?.status, router]);

  const inviteStatusClassName: Record<'open' | 'used' | 'expired' | 'revoked' | 'invalid', string> = {
    open: 'border-blue-200 bg-blue-50 text-blue-700',
    used: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    expired: 'border-amber-200 bg-amber-50 text-amber-700',
    revoked: 'border-slate-200 bg-slate-100 text-slate-700',
    invalid: 'border-slate-200 bg-slate-100 text-slate-700',
  };

  const inviteStatusLabel: Record<'open' | 'used' | 'expired' | 'revoked' | 'invalid', string> = {
    open: 'Versendet',
    used: 'Eingegangen',
    expired: 'Abgelaufen',
    revoked: 'Widerrufen',
    invalid: 'Ungültig',
  };

  return (
    <section className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-semibold text-slate-900">Versendete Personalbögen</h3>
          {deleteInviteState?.message ? (
            <p
              className={`mt-2 rounded-md border px-3 py-2 text-sm ${
                deleteInviteState.status === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {deleteInviteState.message}
            </p>
          ) : null}
          {onboardingInvites.length ? (
            <ul className="mt-3 space-y-2">
              {onboardingInvites.map((invite) => {
                const inviteDisplayName = [invite.firstName, invite.lastName].filter(Boolean).join(' ').trim();
                return (
                  <li
                    key={`onboarding-invite-${invite.id}`}
                    className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {inviteDisplayName || invite.email}
                      </p>
                      <p className="truncate text-xs text-slate-600">{invite.email}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Versendet: {invite.createdAtLabel} · Gültig bis: {invite.expiresAtLabel}
                        {invite.usedAtLabel ? ` · Eingegangen: ${invite.usedAtLabel}` : ''}
                        {invite.employeeDisplayName ? ` · Mitarbeiter: ${invite.employeeDisplayName}` : ''}
                      </p>
                    </div>
                    <span
                      className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-semibold ${inviteStatusClassName[invite.status]}`}
                    >
                      {inviteStatusLabel[invite.status]}
                    </span>
                    <form action={deleteInviteFormAction}>
                      <input type="hidden" name="invite_id" value={String(invite.id)} />
                      <button
                        type="submit"
                        className="ml-2 inline-flex w-fit rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        Löschen
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Noch keine Personalbögen versendet.</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setInviteFormOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-4 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          aria-expanded={inviteFormOpen}
          aria-controls="invite-form-panel"
        >
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Personalbogen-Link senden</h2>
            <p className="mt-2 text-sm text-slate-600">
              Neue Mitarbeitende erhalten einen einmaligen, sicheren Link zum Ausfüllen des Personalbogens inklusive Unterschrift.
              Nach Eingang wird der Mitarbeiter als ausstehend angelegt.
            </p>
          </div>
          <span
            className="inline-flex min-w-24 items-center justify-center rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700"
          >
            {inviteFormOpen ? 'Einklappen' : 'Ausklappen'}
          </span>
        </button>
        {inviteState?.message ? (
          <p
            className={`mt-4 rounded-md border px-3 py-2 text-sm ${
              inviteState.status === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {inviteState.message}
          </p>
        ) : null}
        <form
          id="invite-form-panel"
          action={inviteFormAction}
          className={`${inviteFormOpen ? 'mt-4 grid gap-3 sm:grid-cols-2' : 'hidden'}`}
        >
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Vorname (optional)</span>
            <input name="invite_first_name" className="rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Nachname (optional)</span>
            <input name="invite_last_name" className="rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
            <span>E-Mail *</span>
            <input
              type="email"
              name="invite_email"
              required
              className="rounded-md border border-slate-300 px-3 py-2"
              placeholder="name@beispiel.de"
            />
          </label>
          <div className="sm:col-span-2 mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">Vertragsdaten (Pflicht, vom Admin gesetzt)</p>
            <p className="mt-1 text-xs text-slate-600">
              Diese Felder werden beim Bewerber angezeigt, sind dort aber nicht bearbeitbar.
            </p>
          </div>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Eintrittsdatum *</span>
            <input
              type="date"
              name="invite_entry_date"
              required
              defaultValue=""
              autoComplete="off"
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Tarifgruppe / Jobtitel *</span>
            <input name="invite_tarif_group" required className="rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Einstellungsart *</span>
            <select name="invite_employment_type" required defaultValue="" className="rounded-md border border-slate-300 bg-white px-3 py-2">
              <option value="" disabled>Bitte auswählen</option>
              <option value="befristet">Befristet</option>
              <option value="unbefristet">Unbefristet</option>
              <option value="minijob">Minijob</option>
              <option value="werkstudent">Werkstudent</option>
              <option value="teilzeit">Teilzeit</option>
              <option value="vollzeit">Vollzeit</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Arbeitszeitmodell *</span>
            <select name="invite_work_time_model" required defaultValue="" className="rounded-md border border-slate-300 bg-white px-3 py-2">
              <option value="" disabled>Bitte auswählen</option>
              <option value="vollzeit">Vollzeit</option>
              <option value="teilzeit">Teilzeit</option>
              <option value="schicht">Schichtmodell</option>
              <option value="flexibel">Flexibel</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Std/Woche *</span>
            <input
              type="number"
              min={0.5}
              max={168}
              step={0.5}
              name="invite_weekly_hours"
              required
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Probezeit (Monate) *</span>
            <input type="number" min={0} max={36} step={1} name="invite_probation_months" required className="rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Urlaubstage/Jahr *</span>
            <input type="number" min={1} max={365} step={1} name="invite_vacation_days_total" required className="rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Vergütungsart *</span>
            <select
              name="invite_compensation_type"
              required
              value={inviteCompensationType}
              onChange={(event) => setInviteCompensationType(event.target.value === 'fixed' ? 'fixed' : 'hourly')}
              className="rounded-md border border-slate-300 bg-white px-3 py-2"
            >
              <option value="hourly">Stundenlohn</option>
              <option value="fixed">Festgehalt (Brutto)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Stundenlohn (€) {inviteCompensationType === 'hourly' ? '*' : '(optional)'}</span>
            <input
              type="number"
              step="0.01"
              min={0}
              name="invite_hourly_wage"
              required={inviteCompensationType === 'hourly'}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            <span>Monatsgehalt Brutto (€) {inviteCompensationType === 'fixed' ? '*' : '(optional)'}</span>
            <input
              type="number"
              step="0.01"
              min={0}
              name="invite_monthly_salary_gross"
              required={inviteCompensationType === 'fixed'}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
            <span>Nachricht (optional)</span>
            <textarea
              name="invite_message"
              rows={3}
              className="rounded-md border border-slate-300 px-3 py-2"
              placeholder="Optionaler Hinweis an den Bewerber"
            />
          </label>
          <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-sm font-semibold text-slate-900">Alle übermittelten Felder (Mitarbeiterformular)</p>
            <p className="mt-1 text-xs text-slate-600">
              Diese Felder werden im Personalbogen erhoben und nach Absenden an das Admin-Backend übermittelt.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                'Vorname',
                'Nachname',
                'E-Mail',
                'Telefon',
                'Geburtsdatum (leer)',
                'Straße',
                'Hausnummer',
                'PLZ',
                'Ort',
                'Std/Woche',
                'Nationalität',
                'Familienstand',
                'Steuerklasse',
                'Kinderfreibetrag',
                'Steuer-ID',
                'Sozialversicherungsnummer',
                'Krankenkasse',
                'Versichertennummer',
                'IBAN',
                'BIC',
                'Notfallkontakt Name (optional)',
                'Notfallkontakt Telefon (optional)',
                'Notfallkontakt Beziehung (optional)',
                'Profilfoto (optional)',
                'Dokumente/Anhänge (optional)',
                'Digitale Unterschrift',
              ].map((label) => (
                <div key={label} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                  {label}
                </div>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Einladungslink senden
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700 shadow-inner">
        <h2 className="text-base font-semibold text-slate-900">Zentrale Mitarbeiterverwaltung aktiv</h2>
        <p className="mt-2 text-sm text-slate-600">
          Neue Mitarbeitende werden jetzt zentral im Tenant-Dashboard angelegt. In der Stundenliste kannst du bestehende
          Mitarbeitende nur noch ansehen, aktivieren oder deaktivieren.
        </p>
      </section>

      <section className="space-y-4">
        <header className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
          <h2 className="text-lg font-semibold text-slate-900">Aktive Mitarbeiter</h2>
          {toggleState?.message ? (
            <span
              className={`text-sm ${
                toggleState.status === 'success' ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {toggleState.message}
            </span>
          ) : null}
        </header>
        {activeEmployees.length ? (
          <div className="space-y-3">
            <div className="space-y-3 sm:hidden">
              {activeEmployees.map((employee) => (
                <article key={`mobile-active-${employee.id}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-slate-900">{employee.displayName}</h3>
                  <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-slate-500">Benutzername</dt>
                    <dd className="break-all text-slate-700">{employee.username}</dd>
                    <dt className="text-slate-500">Rolle</dt>
                    <dd className="text-slate-700">{employee.roleId === 2 ? 'Admin' : 'Mitarbeiter'}</dd>
                    <dt className="text-slate-500">Kalender</dt>
                    <dd className="text-slate-700">{employee.showInCalendar ? 'Ja' : 'Nein'}</dd>
                    <dt className="text-slate-500">Onboarding</dt>
                    <dd className="text-slate-700">{employee.onboardingStatus === 'pending' ? 'Ausstehend' : 'Abgeschlossen'}</dd>
                  </dl>
                  <div className="mt-3 grid gap-2">
                    <Link
                      href={`/admin/mitarbeitende/${employee.id}`}
                      className="inline-flex items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-brand transition hover:bg-brand/10"
                    >
                      Details
                    </Link>
                    <form action={toggleFormAction} className="grid">
                      <input type="hidden" name="employeeId" value={employee.id} />
                      <input type="hidden" name="targetStatus" value="deactivate" />
                      <SmallButton label="Deaktivieren" tone="danger" />
                    </form>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
              <table className="w-full min-w-[760px] divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Name</th>
                    <th className="px-4 py-2">Benutzername</th>
                    <th className="px-4 py-2">Rolle</th>
                    <th className="px-4 py-2">Kalender</th>
                    <th className="px-4 py-2">Onboarding</th>
                    <th className="px-4 py-2">Aktion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {activeEmployees.map((employee) => (
                    <tr key={employee.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2 font-medium text-slate-800">{employee.displayName}</td>
                      <td className="px-4 py-2 text-slate-800">{employee.username}</td>
                      <td className="px-4 py-2 text-slate-800">{employee.roleId === 2 ? 'Admin' : 'Mitarbeiter'}</td>
                      <td className="px-4 py-2 text-slate-800">{employee.showInCalendar ? 'Ja' : 'Nein'}</td>
                      <td className="px-4 py-2 text-slate-800">{employee.onboardingStatus === 'pending' ? 'Ausstehend' : 'Abgeschlossen'}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/admin/mitarbeitende/${employee.id}`}
                            className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-brand transition hover:bg-brand/10"
                          >
                            Details
                          </Link>
                          <form action={toggleFormAction}>
                            <input type="hidden" name="employeeId" value={employee.id} />
                            <input type="hidden" name="targetStatus" value="deactivate" />
                            <SmallButton label="Deaktivieren" tone="danger" />
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
            Keine aktiven Mitarbeiter gefunden.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Deaktivierte Mitarbeiter</h2>
        {inactiveEmployees.length ? (
          <div className="space-y-3">
            <div className="space-y-3 sm:hidden">
              {inactiveEmployees.map((employee) => (
                <article key={`mobile-inactive-${employee.id}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-slate-900">{employee.displayName}</h3>
                  <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-slate-500">Benutzername</dt>
                    <dd className="break-all text-slate-700">{employee.username}</dd>
                    <dt className="text-slate-500">Kalender</dt>
                    <dd className="text-slate-700">{employee.showInCalendar ? 'Ja' : 'Nein'}</dd>
                    <dt className="text-slate-500">Onboarding</dt>
                    <dd className="text-slate-700">{employee.onboardingStatus === 'pending' ? 'Ausstehend' : 'Abgeschlossen'}</dd>
                  </dl>
                  <div className="mt-3 grid gap-2">
                    <Link
                      href={`/admin/mitarbeitende/${employee.id}`}
                      className="inline-flex items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                    >
                      Details
                    </Link>
                    <form action={toggleFormAction} className="grid">
                      <input type="hidden" name="employeeId" value={employee.id} />
                      <input type="hidden" name="targetStatus" value="activate" />
                      <SmallButton label="Reaktivieren" tone="success" />
                    </form>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
              <table className="w-full min-w-[680px] divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Name</th>
                    <th className="px-4 py-2">Benutzername</th>
                    <th className="px-4 py-2">Kalender</th>
                    <th className="px-4 py-2">Onboarding</th>
                    <th className="px-4 py-2">Aktion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {inactiveEmployees.map((employee) => (
                    <tr key={employee.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2 font-medium text-slate-800">{employee.displayName}</td>
                      <td className="px-4 py-2 text-slate-800">{employee.username}</td>
                      <td className="px-4 py-2 text-slate-800">{employee.showInCalendar ? 'Ja' : 'Nein'}</td>
                      <td className="px-4 py-2 text-slate-800">{employee.onboardingStatus === 'pending' ? 'Ausstehend' : 'Abgeschlossen'}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/admin/mitarbeitende/${employee.id}`}
                            className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                          >
                            Details
                          </Link>
                          <form action={toggleFormAction}>
                            <input type="hidden" name="employeeId" value={employee.id} />
                            <input type="hidden" name="targetStatus" value="activate" />
                            <SmallButton label="Reaktivieren" tone="success" />
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
            Keine deaktivierten Mitarbeiter vorhanden.
          </p>
        )}
      </section>
    </section>
  );
}
