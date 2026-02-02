'use client';

import Link from 'next/link';
import { useActionState } from 'react';
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
  toggleAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  toggleInitialState: ActionState;
};

export default function AdminEmployeeListClient({
  activeEmployees,
  inactiveEmployees,
  toggleAction,
  toggleInitialState,
}: Props) {
  const [toggleState, toggleFormAction] = useActionState(toggleAction, toggleInitialState);

  return (
    <section className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700 shadow-inner">
        <h2 className="text-base font-semibold text-slate-900">Zentrale Mitarbeiterverwaltung aktiv</h2>
        <p className="mt-2 text-sm text-slate-600">
          Neue Mitarbeitende werden jetzt zentral im Tenant-Dashboard angelegt. In der Stundenliste kannst du bestehende
          Mitarbeitende nur noch ansehen, aktivieren oder deaktivieren.
        </p>
      </section>

      <section className="space-y-4">
        <header className="flex items-center justify-between">
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
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Benutzername</th>
                <th className="px-4 py-2">Rolle</th>
                <th className="px-4 py-2">Kalender</th>
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
              {!activeEmployees.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                    Keine aktiven Mitarbeiter gefunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Deaktivierte Mitarbeiter</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Benutzername</th>
                <th className="px-4 py-2">Kalender</th>
                <th className="px-4 py-2">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {inactiveEmployees.map((employee) => (
                <tr key={employee.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2 font-medium text-slate-800">{employee.displayName}</td>
                  <td className="px-4 py-2 text-slate-800">{employee.username}</td>
                  <td className="px-4 py-2 text-slate-800">{employee.showInCalendar ? 'Ja' : 'Nein'}</td>
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
              {!inactiveEmployees.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                    Keine deaktivierten Mitarbeiter vorhanden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
