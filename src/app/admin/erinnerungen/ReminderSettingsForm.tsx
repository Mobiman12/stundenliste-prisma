'use client';

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { DateTime } from 'luxon';

import type { ReminderFormState, ReminderTestState } from './types';
import type { saveReminderAction, sendTestReminderAction } from './actions';
import type { ReminderLogEntry } from '@/lib/data/reminders';

function computeNextRun(sendHour: number, timezone: string, locale = 'de-DE'): string {
  const zone = timezone || 'Europe/Berlin';
  const now = DateTime.now().setZone(zone);
  const clamped = Math.min(Math.max(sendHour, 0), 23);
  const endOfMonth = now.endOf('month').set({ hour: clamped, minute: 0, second: 0, millisecond: 0 });
  const next = now <= endOfMonth
    ? endOfMonth
    : endOfMonth.plus({ months: 1 }).endOf('month').set({ hour: clamped, minute: 0, second: 0, millisecond: 0 });
  return next.setLocale(locale).toFormat('dd.LL.yyyy HH:mm ZZZZ');
}

function extractKeys(template: string): string[] {
  if (!template) return [];
  const result = new Set<string>();
  const regex = /\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const key = match[1]?.trim();
    if (key) {
      result.add(key);
    }
  }
  return Array.from(result);
}

function renderTemplate(template: string, values: Record<string, string>): string {
  if (!template) {
    return '';
  }
  return template.replace(/\{([^{}]+)\}/g, (full, rawKey: string) => {
    const key = rawKey.trim();
    if (!(key in values)) {
      throw new Error(key);
    }
    return values[key];
  });
}

function usePreview(subject: string, content: string, previewName: string, timezone: string) {
  return useMemo(() => {
    const now = DateTime.now().setZone(timezone || 'Europe/Berlin');
    try {
      const values = {
        first_name: previewName?.trim() || 'Alex',
        month: now.toFormat('LLLL'),
      };
      return {
        subject: renderTemplate(subject, values),
        body: renderTemplate(content, values),
        error: null as string | null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unbekannter Platzhalter';
      return {
        subject: '',
        body: '',
        error: `Unbekannter Platzhalter: {${message}}`,
      };
    }
  }, [subject, content, previewName, timezone]);
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? 'Speichern…' : 'Einstellungen speichern'}
    </button>
  );
}

type ReminderSettingsFormProps = {
  initialSettings: {
    enabled: boolean;
    sendHour: number;
    subject: string;
    contentTemplate: string;
  };
  initialNextRun: string;
  logs: ReminderLogEntry[];
  timezone: string;
  allowedKeys: string[];
  saveAction: typeof saveReminderAction;
  saveInitialState: ReminderFormState;
  testAction: typeof sendTestReminderAction;
};

export default function ReminderSettingsForm({
  initialSettings,
  initialNextRun,
  logs,
  timezone,
  allowedKeys,
  saveAction,
  saveInitialState,
  testAction,
}: ReminderSettingsFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [formState, formAction] = useActionState(saveAction, saveInitialState);
  const [testState, setTestState] = useState<ReminderTestState>({});
  const [isTesting, startTest] = useTransition();

  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [sendHour, setSendHour] = useState(initialSettings.sendHour);
  const [subject, setSubject] = useState(initialSettings.subject);
  const [contentTemplate, setContentTemplate] = useState(initialSettings.contentTemplate);
  const [previewName, setPreviewName] = useState('Alex');
  const [testEmail, setTestEmail] = useState('');
  const [nextRun, setNextRun] = useState(initialNextRun || computeNextRun(initialSettings.sendHour, timezone));

  useEffect(() => {
    if (formState?.settings) {
      setEnabled(formState.settings.enabled);
      setSendHour(formState.settings.sendHour);
      setSubject(formState.settings.subject);
      setContentTemplate(formState.settings.contentTemplate);
    }
    if (formState?.nextRun) {
      setNextRun(formState.nextRun);
    } else {
      setNextRun(computeNextRun(sendHour, timezone));
    }
  }, [formState, sendHour, timezone]);

  useEffect(() => {
    setNextRun(computeNextRun(sendHour, timezone));
  }, [sendHour, timezone]);

  const preview = usePreview(subject, contentTemplate, previewName, timezone);
  const placeholderKeys = useMemo(() => {
    const keys = new Set<string>();
    extractKeys(subject).forEach((k) => keys.add(k));
    extractKeys(contentTemplate).forEach((k) => keys.add(k));
    return Array.from(keys);
  }, [subject, contentTemplate]);

  const handleTestMail = () => {
    if (!formRef.current) {
      return;
    }
    const formData = new FormData(formRef.current);
    formData.set('testEmail', testEmail);
    formData.set('previewName', previewName);

    startTest(async () => {
      const result = await testAction(formData);
      setTestState(result);
    });
  };

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-900">E-Mail-Erinnerungen</h2>
        <p className="text-sm text-slate-500">
          Versand am letzten Tag des Monats. Platzhalter: {allowedKeys.map((key) => `{${key}}`).join(', ')}.
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

      {testState?.status && testState.message ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            testState.status === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {testState.message}
        </div>
      ) : null}

      <form ref={formRef} action={formAction} className="space-y-6">
        <div className="flex items-center gap-3">
          <input
            id="enabled"
            name="enabled"
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="enabled" className="text-sm text-slate-700">
            Monatliche Erinnerung aktivieren
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span>Versandstunde (0–23)</span>
            <input
              name="sendHour"
              type="number"
              min={0}
              max={23}
              value={sendHour}
              onChange={(event) => {
                const value = Number(event.target.value);
                setSendHour(Number.isFinite(value) ? value : 0);
              }}
              className="rounded-md border border-slate-300 px-3 py-2"
              required
            />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span>Nächster geplanter Versand</span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
              {nextRun} ({timezone})
            </span>
          </div>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span>Betreff</span>
          <input
            name="subject"
            type="text"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2"
            placeholder="Erinnerung: Stundenliste vervollständigen"
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>E-Mail-Text</span>
          <textarea
            name="contentTemplate"
            rows={8}
            value={contentTemplate}
            onChange={(event) => setContentTemplate(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2"
            placeholder="Verwende {first_name} und {month} als Platzhalter"
            required
          />
        </label>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <h3 className="font-semibold text-slate-800">Platzhalter in Verwendung</h3>
          <p className="mt-1 text-slate-600">
            {placeholderKeys.length
              ? placeholderKeys.map((key) => `{${key}}`).join(', ')
              : 'Keine Platzhalter verwendet.'}
          </p>
          {formState.unknownKeys?.length ? (
            <p className="mt-2 text-sm text-red-600">
              Unbekannt: {formState.unknownKeys.map((key) => `{${key}}`).join(', ')}
            </p>
          ) : null}
        </div>

        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">Vorschau</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span>Vorname für Vorschau</span>
              <input
                name="previewName"
                type="text"
                value={previewName}
                onChange={(event) => setPreviewName(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Test-Empfänger</span>
              <input
                name="testEmail"
                type="email"
                value={testEmail}
                onChange={(event) => setTestEmail(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2"
                placeholder="name@example.com"
              />
            </label>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">
            {preview.error ? (
              <span className="text-red-600">{preview.error}</span>
            ) : (
              <pre className="whitespace-pre-wrap">{`Betreff: ${preview.subject}\n\n${preview.body}`}</pre>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <SaveButton />
            <button
              type="button"
              onClick={handleTestMail}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isTesting}
            >
              {isTesting ? 'Testmail wird gesendet…' : 'Testmail senden'}
            </button>
          </div>
        </div>
      </form>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">Versand-Logs</h3>
        {logs.length ? (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Periode</th>
                  <th className="px-3 py-2">Gesendet</th>
                  <th className="px-3 py-2">Fehler</th>
                  <th className="px-3 py-2">Zeitpunkt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {logs.map((log) => (
                  <tr key={log.periodKey}>
                    <td className="px-3 py-2">{log.periodKey}</td>
                    <td className="px-3 py-2">{log.sentCount}</td>
                    <td className="px-3 py-2">{log.errorCount}</td>
                    <td className="px-3 py-2">{log.sentAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            Noch keine Versand-Logs vorhanden.
          </p>
        )}
      </section>
    </section>
  );
}
