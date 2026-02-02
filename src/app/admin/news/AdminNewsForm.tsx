'use client';

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { DateTime } from 'luxon';

import type { AdminNewsItem } from '@/lib/services/news';
import type { DeleteState, NewsFormState } from './page';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="self-start rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? 'Speichern…' : 'Neuigkeit speichern'}
    </button>
  );
}

type AdminNewsFormProps = {
  news: AdminNewsItem[];
  createAction: (prevState: NewsFormState, formData: FormData) => Promise<NewsFormState>;
  createInitialState: NewsFormState;
  deleteAction: (formData: FormData) => Promise<DeleteState>;
};

function formatTimestamp(value: string): string {
  const dt = DateTime.fromSQL(value, { zone: 'Europe/Berlin' });
  if (dt.isValid) {
    return dt.setLocale('de').toFormat('dd.LL.yyyy HH:mm');
  }
  const fallback = DateTime.fromISO(value, { zone: 'Europe/Berlin' });
  if (fallback.isValid) {
    return fallback.setLocale('de').toFormat('dd.LL.yyyy HH:mm');
  }
  return value;
}

export default function AdminNewsForm({
  news,
  createAction,
  createInitialState,
  deleteAction,
}: AdminNewsFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [formState, formAction] = useActionState(createAction, createInitialState);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isDeleting, startDelete] = useTransition();

  useEffect(() => {
    if (formState?.status === 'success') {
      formRef.current?.reset();
    }
  }, [formState?.status]);

  const handleDelete = (id: number) => {
    if (isDeleting) return;

    setDeletingId(id);
    setDeleteState(null);
    const formData = new FormData();
    formData.set('newsId', String(id));

    startDelete(() => {
      deleteAction(formData)
        .then((result) => {
          if (result.status === 'error') {
            setDeleteState(result);
          } else {
            setDeleteState(null);
          }
        })
        .catch((error: unknown) => {
          setDeleteState({
            status: 'error',
            message:
              error instanceof Error ? error.message : 'Löschen fehlgeschlagen.',
          });
        })
        .finally(() => {
          setDeletingId(null);
        });
    });
  };

  const newestFirst = useMemo(() => news, [news]);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Neuigkeiten verwalten</h1>
        <p className="text-sm text-slate-500">
          Erstelle Mitteilungen für Mitarbeitende und behalte den Überblick über bestehende Beiträge.
        </p>
      </header>

      {formState?.status && formState.message ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            formState.status === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {formState.message}
        </div>
      ) : null}

      {deleteState?.status === 'error' && deleteState.message ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {deleteState.message}
        </div>
      ) : null}

      <form ref={formRef} action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Neue Neuigkeit anlegen</h2>

        <label className="flex flex-col gap-1 text-sm">
          <span>Titel</span>
          <input
            name="title"
            type="text"
            maxLength={120}
            placeholder="Titel der Neuigkeit"
            className="rounded-md border border-slate-300 px-3 py-2"
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>Inhalt</span>
          <textarea
            name="content"
            rows={6}
            className="rounded-md border border-slate-300 px-3 py-2"
            placeholder="Beschreibe hier die Neuigkeit für deine Mitarbeitenden."
            required
          />
        </label>

        <SubmitButton />
      </form>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Bestehende Neuigkeiten</h2>

        {!newestFirst.length ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Noch keine Neuigkeiten vorhanden.
          </p>
        ) : (
          <ul className="space-y-4">
            {newestFirst.map((item) => (
              <li key={item.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
                  <span className="text-xs uppercase tracking-wide text-slate-400">
                    {formatTimestamp(item.createdAt)}
                  </span>
                </header>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{item.content}</p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isDeleting && deletingId === item.id}
                  >
                    {isDeleting && deletingId === item.id ? 'Löschen…' : 'Löschen'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
