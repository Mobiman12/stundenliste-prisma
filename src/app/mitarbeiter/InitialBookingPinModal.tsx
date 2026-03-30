'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';

type PinSetupState = {
  status: 'success' | 'error';
  message: string;
} | null;

type InitialBookingPinModalProps = {
  action: (prevState: PinSetupState, formData: FormData) => Promise<PinSetupState>;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-brand/60"
    >
      {pending ? 'PIN wird gespeichert…' : 'PIN speichern'}
    </button>
  );
}

export function InitialBookingPinModal({ action }: InitialBookingPinModalProps) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.status === 'success') {
      router.refresh();
    }
  }, [router, state?.status]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 px-4 py-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Buchungs-PIN festlegen</h2>
        <p className="mt-2 text-sm text-slate-600">
          Bitte lege jetzt deine persönliche 4-stellige Buchungs-PIN fest. Ohne PIN ist der Zugriff auf Kalenderfunktionen nicht möglich.
        </p>

        {state ? (
          <div
            className={`mt-4 rounded-md border px-3 py-2 text-sm ${
              state.status === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {state.message}
          </div>
        ) : null}

        <form action={formAction} className="mt-5 space-y-4" autoComplete="off">
          <label className="block text-sm text-slate-700">
            <span className="mb-1 block font-medium">Neue PIN</span>
            <input
              name="new_pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4}"
              minLength={4}
              maxLength={4}
              autoComplete="off"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            />
          </label>
          <label className="block text-sm text-slate-700">
            <span className="mb-1 block font-medium">Neue PIN (Wiederholung)</span>
            <input
              name="confirm_pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4}"
              minLength={4}
              maxLength={4}
              autoComplete="off"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            />
          </label>
          <div className="flex justify-end">
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  );
}
