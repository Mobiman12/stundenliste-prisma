'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FEDERAL_STATE_OPTIONS } from '@/lib/constants/federal-states';

export type ProfileActionState = {
  status: 'success' | 'error';
  message: string;
} | null;

export interface EmployeeProfileView {
  firstName: string;
  lastName: string;
  street: string | null;
  zipCode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  entryDate: string;
  personnelNumber: string;
  federalState: string | null;
  bookingPin: string;
}

interface Props {
  profile: EmployeeProfileView;
  updateProfileAction: (prevState: ProfileActionState, formData: FormData) => Promise<ProfileActionState>;
  updatePasswordAction: (prevState: ProfileActionState, formData: FormData) => Promise<ProfileActionState>;
  updateBookingPinAction: (prevState: ProfileActionState, formData: FormData) => Promise<ProfileActionState>;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1 disabled:cursor-not-allowed disabled:bg-brand/50"
      disabled={pending}
    >
      {pending ? `${label}…` : label}
    </button>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function EmployeeProfileClient({
  profile,
  updateProfileAction,
  updatePasswordAction,
  updateBookingPinAction,
}: Props) {
  const [profileState, profileFormAction] = useActionState(updateProfileAction, null);
  const [passwordState, passwordFormAction] = useActionState(updatePasswordAction, null);
  const [pinState, pinFormAction] = useActionState(updateBookingPinAction, null);

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Profil &amp; Einstellungen</h2>
        <p className="text-sm text-slate-500">
          Aktualisiere deine Kontaktdaten oder ändere dein Passwort. Pflichtangaben sind mit einem Stern markiert.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Persönliche Daten</h3>
          <p className="text-sm text-slate-500">
            Diese Angaben erscheinen auch im Admin-Bereich. Bitte halte sie aktuell, damit wir dich erreichen können.
          </p>

          {profileState ? (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                profileState.status === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-red-200 bg-red-50 text-red-600'
              }`}
            >
              {profileState.message}
            </div>
          ) : null}

          <form action={profileFormAction} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Vorname *</span>
                <input
                  name="first_name"
                  defaultValue={profile.firstName}
                  required
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Nachname *</span>
                <input
                  name="last_name"
                  defaultValue={profile.lastName}
                  required
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Straße</span>
                <input
                  name="street"
                  defaultValue={profile.street ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>PLZ</span>
                <input
                  name="zip_code"
                  defaultValue={profile.zipCode ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Ort</span>
                <input
                  name="city"
                  defaultValue={profile.city ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Bundesland (Feiertage)</span>
                <select
                  name="federal_state"
                  defaultValue={profile.federalState ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                >
                  <option value="">Nur bundesweite Feiertage</option>
                  {FEDERAL_STATE_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Telefon</span>
                <input
                  name="phone"
                  defaultValue={profile.phone ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>E-Mail</span>
                <input
                  name="email"
                  type="email"
                  defaultValue={profile.email ?? ''}
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Geburtsdatum</span>
                <input
                  name="birth_date"
                  type="date"
                  defaultValue={formatDate(profile.birthDate)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                />
              </label>
            </div>

            <div className="flex justify-end">
              <SubmitButton label="Profil speichern" />
            </div>
          </form>
        </div>

        <aside className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Stammdaten</h3>
          <dl className="space-y-2 text-sm text-slate-600">
            <div className="flex justify-between">
              <dt className="font-medium text-slate-700">Personalnummer</dt>
              <dd>{profile.personnelNumber}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="font-medium text-slate-700">Eintritt am</dt>
              <dd>{new Date(`${profile.entryDate}T00:00:00`).toLocaleDateString('de-DE')}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Buchungs-PIN ändern</h3>
        <p className="text-sm text-slate-500">
          Die 4-stellige Buchungs-PIN wird für Einträge im Kalender benötigt. Teile sie nicht mit anderen Personen.
        </p>
        <p className="text-xs text-slate-400">
          Falls du deine aktuelle PIN vergessen hast, wende dich bitte an den Administrator.
        </p>

        {pinState ? (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              pinState.status === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-600'
            }`}
          >
            {pinState.message}
          </div>
        ) : null}

        <form action={pinFormAction} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span>Aktuelle PIN *</span>
              <input
                name="current_pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4}"
                minLength={4}
                maxLength={4}
                autoComplete="off"
                required
                className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span>Neue PIN *</span>
              <input
                name="new_pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4}"
                minLength={4}
                maxLength={4}
                autoComplete="off"
                required
                className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span>Neue PIN (Wiederholung) *</span>
              <input
                name="confirm_pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4}"
                minLength={4}
                maxLength={4}
                autoComplete="off"
                required
                className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <SubmitButton label="PIN ändern" />
          </div>
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Passwort ändern</h3>
        <p className="text-sm text-slate-500">Mindestens 8 Zeichen, Groß-/Kleinschreibung beachten.</p>

        {passwordState ? (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              passwordState.status === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-600'
            }`}
          >
            {passwordState.message}
          </div>
        ) : null}

        <form action={passwordFormAction} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span>Aktuelles Passwort *</span>
              <input
                name="current_password"
                type="password"
                autoComplete="current-password"
                required
                className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span>Neues Passwort *</span>
              <input
                name="new_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span>Neues Passwort (Wiederholung) *</span>
              <input
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <SubmitButton label="Passwort ändern" />
          </div>
        </form>
      </div>
    </section>
  );
}
