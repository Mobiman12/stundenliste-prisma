'use client';

import { useMemo, useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { LeaveRequestView } from '@/lib/services/leave-requests';

export type DecideRequestFormState = {
  status: 'idle' | 'success' | 'error';
  message: string | null;
};

type Props = {
  requests: LeaveRequestView[];
  decideAction: (
    prevState: DecideRequestFormState,
    formData: FormData
  ) => Promise<DecideRequestFormState>;
};

const INITIAL_STATE: DecideRequestFormState = {
  status: 'idle',
  message: null,
};

function DecisionButtons() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="submit"
        name="decision"
        value="approve"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Genehmigen
      </button>
      <button
        type="submit"
        name="decision"
        value="reject"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Ablehnen
      </button>
    </div>
  );
}

function CancellationButtons() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="submit"
        name="decision"
        value="cancel_confirm"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Storno bestätigen
      </button>
      <button
        type="submit"
        name="decision"
        value="cancel_deny"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Storno ablehnen
      </button>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return formatDate(iso.slice(0, 10));
  }
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimeLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const trimmed = value.trim();
  if (!trimmed) return '—';
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return trimmed.padStart(5, '0');
  }
  return trimmed;
}

function DecisionForm({
  request,
  decideAction,
}: {
  request: LeaveRequestView;
  decideAction: (
    prevState: DecideRequestFormState,
    formData: FormData
  ) => Promise<DecideRequestFormState>;
}) {
  const [state, formAction] = useActionState(decideAction, INITIAL_STATE);

  if (request.cancellationRequested) {
    const showFeedback = state.status !== 'idle' && state.message;
    const feedbackClass =
      state.status === 'success'
        ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border border-red-200 bg-red-50 text-red-700';

    return (
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="request_id" value={request.id} />
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Der Mitarbeiter bittet um Stornierung. Bitte bestätigen oder lehnen Sie diese Anfrage ab.
        </div>
        {request.cancellationNote ? (
          <p className="text-xs text-slate-600">
            Storno-Notiz: <span className="font-medium text-slate-800">{request.cancellationNote}</span>
          </p>
        ) : null}
        <div>
          <label
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            htmlFor={`admin_note_${request.id}`}
          >
            Antwort für Mitarbeiter (optional)
          </label>
          <textarea
            id={`admin_note_${request.id}`}
            name="admin_note"
            rows={2}
            defaultValue={request.adminNote ?? ''}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            placeholder="Optional: Begründung für die Entscheidung"
            maxLength={500}
          />
        </div>
        <CancellationButtons />
        {showFeedback ? <p className={`rounded-lg px-3 py-2 text-xs ${feedbackClass}`}>{state.message}</p> : null}
      </form>
    );
  }

  if (request.status !== 'pending') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">
          Letztes Update:{' '}
          <span className="font-medium text-slate-800">
            {request.decidedAt ? formatDateTime(request.decidedAt) : '—'}
          </span>
        </p>
        <p className="text-sm text-slate-500">
          Kommentar:{' '}
          {request.adminNote ? (
            <span className="text-slate-800">{request.adminNote}</span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </p>
      </div>
    );
  }

  const showFeedback = state.status !== 'idle' && state.message;
  const feedbackClass =
    state.status === 'success'
      ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border border-red-200 bg-red-50 text-red-700';

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="request_id" value={request.id} />
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={`admin_note_${request.id}`}>
          Kommentar für Mitarbeiter (optional)
        </label>
        <textarea
          id={`admin_note_${request.id}`}
          name="admin_note"
          rows={2}
          defaultValue={request.adminNote ?? ''}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          placeholder="Optionale Rückmeldung an den Mitarbeiter"
          maxLength={500}
        />
      </div>
      <DecisionButtons />
      {showFeedback ? (
        <p className={`rounded-lg px-3 py-2 text-xs ${feedbackClass}`}>{state.message}</p>
      ) : null}
    </form>
  );
}

export default function AdminLeaveRequestsClient({ requests, decideAction }: Props) {
  const sortedRequests = useMemo(
    () =>
      [...requests].sort((a, b) => {
        const priority = (request: LeaveRequestView) => {
          if (request.cancellationRequested) return 0;
          if (request.status === 'pending') return 1;
          if (request.status === 'approved') return 2;
          return 3;
        };
        const diff = priority(a) - priority(b);
        if (diff !== 0) {
          return diff;
        }
        return b.createdAt.localeCompare(a.createdAt);
      }),
    [requests]
  );

  const pendingCount = sortedRequests.filter(
    (request) => request.status === 'pending' || request.cancellationRequested
  ).length;

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="mb-4 space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Anträge auf Urlaub & Überstundenabbau</h1>
          <p className="text-sm text-slate-500">
            Verwalte eingegangene Anträge. Genehmigte Anträge werden automatisch in den Schichtplan übernommen.
          </p>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Offene Anträge: <span className="text-brand">{pendingCount}</span>
          </p>
        </header>

        {sortedRequests.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            Es liegen aktuell keine Anträge vor.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Mitarbeiter
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Zeitraum
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Typ
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Details
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Verwaltung
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sortedRequests.map((request) => {
                  const rowHighlight = request.cancellationRequested
                    ? 'bg-amber-100'
                    : request.status === 'pending'
                    ? 'bg-amber-50'
                    : request.status === 'approved'
                    ? 'bg-emerald-50'
                    : 'bg-red-50';
                  const statusBadgeClasses = request.cancellationRequested
                    ? 'bg-amber-200 text-amber-800 border border-amber-300'
                    : request.status === 'approved'
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                    : request.status === 'rejected'
                    ? 'bg-red-100 text-red-700 border border-red-200'
                    : 'bg-amber-100 text-amber-700 border border-amber-200';

                  return (
                    <tr key={request.id} className={`transition hover:bg-slate-100 ${rowHighlight}`}>
                      <td className="px-4 py-4">
                        <div className="text-sm font-semibold text-slate-900">
                          {request.employeeName ?? `Mitarbeiter #${request.employeeId}`}
                        </div>
                        <div className="text-xs text-slate-500">
                          Antrag vom {formatDateTime(request.createdAt)}
                        </div>
                        <div className="mt-2">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClasses}`}>
                            {request.statusLabel}
                          </span>
                          {request.cancellationRequested ? (
                            <p className="mt-1 text-xs font-medium text-amber-700">
                              Storno angefragt seit{' '}
                              {formatDateTime(request.cancellationRequestedAt ?? request.updatedAt)}
                            </p>
                          ) : null}
                          {request.cancelledAt ? (
                            <p className="mt-1 text-xs text-slate-600">
                              Storniert am {formatDateTime(request.cancelledAt)}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-medium text-slate-900">
                          {formatDate(request.startDate)} – {formatDate(request.endDate)}
                        </div>
                        <div className="text-xs text-slate-500">{request.totalDays} Tage</div>
                        {request.startTime && request.endTime ? (
                          <div className="text-xs text-slate-500">
                            Zeiten: {formatTimeLabel(request.startTime)} – {formatTimeLabel(request.endTime)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-4 text-slate-700">{request.typeLabel}</td>
                      <td className="px-4 py-4 text-slate-600">
                        {request.reason ? request.reason : <span className="text-slate-400">Keine Notiz</span>}
                        {request.cancellationNote ? (
                          <p className="mt-2 text-xs text-slate-500">
                            Storno-Notiz: <span className="font-medium text-slate-700">{request.cancellationNote}</span>
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <DecisionForm request={request} decideAction={decideAction} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
