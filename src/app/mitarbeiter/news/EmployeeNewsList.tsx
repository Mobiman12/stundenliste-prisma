'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';

import type { EmployeeNewsItem } from '@/lib/services/news';
import type { markNewsReadAction, MarkState } from './page';

type Props = {
  news: EmployeeNewsItem[];
  markAsReadAction: typeof markNewsReadAction;
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const primary = DateTime.fromSQL(value, { zone: 'Europe/Berlin' });
  if (primary.isValid) {
    return primary.setLocale('de').toFormat('dd.LL.yyyy HH:mm');
  }
  const fallback = DateTime.fromISO(value, { zone: 'Europe/Berlin' });
  if (fallback.isValid) {
    return fallback.setLocale('de').toFormat('dd.LL.yyyy HH:mm');
  }
  return value;
}

export default function EmployeeNewsList({ news, markAsReadAction }: Props) {
  const router = useRouter();
  const [actionState, setActionState] = useState<MarkState | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showReadItems, setShowReadItems] = useState(false);

  const unreadNews = useMemo(() => news.filter((item) => !item.isRead), [news]);
  const readNews = useMemo(() => news.filter((item) => item.isRead), [news]);

  const handleMarkRead = (id: number) => {
    if (isPending) return;
    const formData = new FormData();
    formData.set('newsId', String(id));

    setPendingId(id);
    setActionState(null);

    startTransition(() => {
      markAsReadAction(formData)
        .then((result) => {
          if (result.status === 'success') {
            setActionState(null);
            router.refresh();
          } else {
            setActionState(result);
          }
        })
        .catch((error: unknown) => {
          setActionState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Markierung fehlgeschlagen.',
          });
        })
        .finally(() => {
          setPendingId(null);
        });
    });
  };

  const unreadCount = unreadNews.length;
  const readCount = readNews.length;

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Neuigkeiten</h1>
        <p className="text-sm text-slate-500">
          Hier findest du alle Mitteilungen deines Teams. Ungelesene Nachrichten werden hervorgehoben und können direkt bestätigt werden.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-600">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1">
            <span>Ungelesen:</span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">{unreadCount}</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1">
            <span>Gelesen:</span>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">{readCount}</span>
          </div>
          {readCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowReadItems((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {showReadItems ? 'Gelesene verbergen' : 'Gelesene anzeigen'}
            </button>
          ) : null}
        </div>
      </header>

      {actionState?.status === 'error' && actionState.message ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionState.message}
        </div>
      ) : null}

      {!news.length ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Es wurden noch keine Neuigkeiten veröffentlicht.
        </p>
      ) : null}

      {unreadNews.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Ungelesene Nachrichten</h2>
          {unreadNews.map((item) => (
            <details
              key={item.id}
              open
              onToggle={(event) => {
                if (!item.isRead && event.currentTarget.open) {
                  handleMarkRead(item.id);
                }
              }}
              className={`space-y-3 rounded-xl border p-4 shadow-sm transition ${
                item.isRead ? 'border-slate-200 bg-white' : 'border-brand/40 bg-brand/5 shadow-brand/20'
              }`}
            >
              <summary className="flex cursor-pointer flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-base font-semibold text-slate-900">{item.title}</span>
                <span className="text-xs uppercase tracking-wide text-slate-400">
                  {formatTimestamp(item.createdAt)}
                </span>
              </summary>
              <div className="space-y-3 text-sm text-slate-700">
                <p className="whitespace-pre-wrap">{item.content}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>Erstellt am {formatTimestamp(item.createdAt)}</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                    Noch nicht bestätigt
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleMarkRead(item.id)}
                  className="inline-flex items-center gap-2 rounded-md border border-brand px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending && pendingId === item.id}
                >
                  {isPending && pendingId === item.id ? 'Markiere…' : 'Als gelesen markieren'}
                </button>
              </div>
            </details>
          ))}
        </section>
      ) : null}

      {readNews.length > 0 && showReadItems ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Bereits gelesen</h2>
          {readNews.map((item) => (
            <details
              key={item.id}
              className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <summary className="flex cursor-pointer flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-base font-semibold text-slate-900">{item.title}</span>
                <span className="text-xs uppercase tracking-wide text-slate-400">
                  {formatTimestamp(item.createdAt)}
                </span>
              </summary>
              <div className="space-y-3 text-sm text-slate-700">
                <p className="whitespace-pre-wrap">{item.content}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>Gelesen am {formatTimestamp(item.readAt)}</span>
                </div>
              </div>
            </details>
          ))}
        </section>
      ) : null}
    </section>
  );
}
