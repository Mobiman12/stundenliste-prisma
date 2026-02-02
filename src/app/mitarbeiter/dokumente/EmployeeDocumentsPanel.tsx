'use client';

import { useActionState, useMemo } from 'react';
import { useFormStatus } from 'react-dom';
import { DateTime } from 'luxon';

import type { DocumentInfo } from '@/lib/services/documents';
import type { UploadState } from './page';

type Props = {
  employeeId: number;
  documents: DocumentInfo[];
  uploadAction: (prevState: UploadState, formData: FormData) => Promise<UploadState>;
  initialUploadState: UploadState;
  allowedExtensions: readonly string[];
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const dt = DateTime.fromISO(value);
  if (!dt.isValid) return value;
  return dt.setLocale('de').toFormat('dd.LL.yyyy HH:mm');
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? 'Lädt…' : 'Hochladen'}
    </button>
  );
}

export default function EmployeeDocumentsPanel({
  employeeId,
  documents,
  uploadAction,
  initialUploadState,
  allowedExtensions,
}: Props) {
  const [uploadState, uploadFormAction] = useActionState(uploadAction, initialUploadState);
  const downloadBase = useMemo(
    () => `/api/documents/${employeeId}`,
    [employeeId]
  );

  const extensionList = allowedExtensions.map((ext) => `.${ext}`).join(', ');

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Dokumente</h1>
        <p className="text-sm text-slate-500">
          Lade hier Unterlagen hoch oder lade bestehende Dokumente herunter. Zulässige Formate: {extensionList}.
        </p>
      </header>

      {uploadState?.status && uploadState.message ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            uploadState.status === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {uploadState.message}
        </div>
      ) : null}

      <form action={uploadFormAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Neues Dokument hochladen</h2>
        <div className="flex flex-col gap-2 text-sm">
          <label htmlFor="file" className="font-medium text-slate-700">
            Datei auswählen
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept={extensionList}
            required
            className="w-full rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600"
          />
          <p className="text-xs text-slate-500">Maximalgröße: 10 MB.</p>
        </div>
        <SubmitButton />
      </form>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Verfügbare Dokumente</h2>
        {!documents.length ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Es sind noch keine Dokumente vorhanden.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Datei</th>
                  <th className="px-4 py-2">Quelle</th>
                  <th className="px-4 py-2">Größe</th>
                  <th className="px-4 py-2">Hochgeladen</th>
                  <th className="px-4 py-2">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {documents.map((doc) => {
                  const downloadHref = `${downloadBase}/${encodeURIComponent(doc.fileName)}`;
                  return (
                    <tr key={doc.fileName}>
                      <td className="px-4 py-2 font-medium text-slate-800">{doc.originalName}</td>
                      <td className="px-4 py-2 text-slate-600">{doc.uploadedBy === 'admin' ? 'Admin' : 'Selbst hochgeladen'}</td>
                      <td className="px-4 py-2 text-slate-600">{formatSize(doc.size)}</td>
                      <td className="px-4 py-2 text-slate-600">{formatDate(doc.uploadedAt)}</td>
                      <td className="px-4 py-2 text-slate-600">
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={downloadHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Anzeigen
                          </a>
                          <a
                            href={downloadHref}
                            download={doc.originalName}
                            className="inline-flex items-center gap-1 rounded-md border border-brand px-3 py-1 text-xs font-medium text-brand hover:bg-brand/10"
                          >
                            Download
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
