'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';

import type {
  AdminDocumentOverviewEntry,
  AdminDocumentTypeOption,
  DocumentInfo,
  DocumentMailLog,
  DocumentTypeKey,
} from '@/lib/services/documents';
import type { AdminDeleteState, AdminUploadState } from './types';
import type { adminDeleteDocumentAction, adminUploadDocumentAction } from './actions';

type EmployeeOption = {
  id: number;
  name: string;
  email: string;
};

type Props = {
  employees: EmployeeOption[];
  selectedEmployeeId: number | null;
  documents: DocumentInfo[];
  allowedExtensions: readonly string[];
  documentTypes: AdminDocumentTypeOption[];
  overviewDocuments: AdminDocumentOverviewEntry[];
  uploadAction: typeof adminUploadDocumentAction;
  uploadInitialState: AdminUploadState;
  deleteAction: typeof adminDeleteDocumentAction;
  deleteInitialState: AdminDeleteState;
};

function formatDate(value: string): string {
  const dt = DateTime.fromISO(value);
  if (!dt.isValid) return value;
  return dt.setLocale('de').toFormat('dd.LL.yyyy HH:mm');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeMailStatus(log: DocumentMailLog | null | undefined): {
  label: string;
  tone: 'muted' | 'success' | 'warning' | 'error';
  detail?: string;
} {
  if (!log) {
    return { label: 'Keine Information', tone: 'muted' };
  }

  switch (log.status) {
    case 'sent':
      return {
        label: log.withAttachment ? 'Versendet (Anhang)' : 'Versendet',
        tone: 'success',
        detail: log.sentAt ?? undefined,
      };
    case 'failed':
      return {
        label: 'Versand fehlgeschlagen',
        tone: 'error',
        detail: log.error ?? undefined,
      };
    case 'skipped':
    default:
      return {
        label: 'Nicht versendet',
        tone: 'warning',
        detail: log.error ?? undefined,
      };
  }
}

function UploadButton({ disabled, disabledReason }: { disabled?: boolean; disabledReason?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formEncType="multipart/form-data"
      className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-60"
      title={disabled && disabledReason ? disabledReason : undefined}
      disabled={disabled || pending}
    >
      {pending ? 'Lädt…' : 'Hochladen'}
    </button>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? 'Löschen…' : 'Löschen'}
    </button>
  );
}

export default function AdminDocumentsPanel({
  employees,
  selectedEmployeeId,
  documents,
  allowedExtensions,
  documentTypes,
  overviewDocuments,
  uploadAction,
  uploadInitialState,
  deleteAction,
  deleteInitialState,
}: Props) {
  const router = useRouter();
  const [uploadState, uploadFormAction] = useActionState(uploadAction, uploadInitialState);
  const [deleteState, deleteFormAction] = useActionState(deleteAction, deleteInitialState);

  const extensionList = allowedExtensions.map((ext) => `.${ext}`).join(', ');
  const hasSelection = typeof selectedEmployeeId === 'number' && selectedEmployeeId > 0;
  const selectedEmployee = hasSelection
    ? employees.find((employee) => employee.id === selectedEmployeeId) ?? null
    : null;

  const downloadBase = useMemo(
    () => (hasSelection ? `/api/documents/${selectedEmployeeId}` : ''),
    [hasSelection, selectedEmployeeId]
  );
  const documentTypeMap = useMemo(
    () => new Map(documentTypes.map((option) => [option.key, option])),
    [documentTypes]
  );

  const [documentTypeKey, setDocumentTypeKey] = useState<string>('');
  const [documentTypeWarning, setDocumentTypeWarning] = useState<string | null>(null);
  const currentType = documentTypeKey
    ? documentTypeMap.get(documentTypeKey as DocumentTypeKey)
    : undefined;

  const [sendMail, setSendMail] = useState(true);
  const [sendAttachment, setSendAttachment] = useState(false);

  useEffect(() => {
    if (!hasSelection) {
      setDocumentTypeKey('');
      setDocumentTypeWarning(null);
    }
  }, [hasSelection]);

  useEffect(() => {
    if (!documentTypeKey) {
      setSendMail(true);
      setSendAttachment(false);
      return;
    }

    const selectedType = documentTypeMap.get(documentTypeKey as DocumentTypeKey);
    if (!selectedType) {
      setSendMail(true);
      setSendAttachment(false);
      return;
    }

    const isSensitive = Boolean(selectedType.sensitive);
    setSendMail(!isSensitive);
    setSendAttachment(!isSensitive);
  }, [documentTypeKey, documentTypeMap]);

  const previewName = useMemo(() => {
    if (!currentType) return '';
    const now = DateTime.now();
    const date = currentType.forcePreviousMonth ? now.minus({ months: 1 }) : now;
    return `${currentType.slug}_${date.toFormat('LLyyyy')}.pdf`;
  }, [currentType]);

  const unseenOverview = useMemo(() => overviewDocuments.slice(0, 25), [overviewDocuments]);
  const uploadDisabled = !hasSelection;
  const employeeDocuments = useMemo(
    () => documents.filter((doc) => doc.uploadedBy === 'employee'),
    [documents]
  );
  const adminDocuments = useMemo(
    () => documents.filter((doc) => doc.uploadedBy === 'admin'),
    [documents]
  );

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Dokumente verwalten</h1>
        <p className="text-sm text-slate-500">
          Lade Dokumente für Mitarbeitende hoch, versende Benachrichtigungen und verwalte bestehende Dateien.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="employee" className="text-sm font-medium text-slate-700">
          Mitarbeiter auswählen
        </label>
        <select
          id="employee"
          name="employee"
          value={hasSelection ? String(selectedEmployeeId) : ''}
          onChange={(event) => {
            const nextId = event.target.value;
            setDocumentTypeWarning(null);
            router.replace(nextId ? `/admin/dokumente?employeeId=${nextId}` : '/admin/dokumente');
          }}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            – bitte wählen –
          </option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
            </option>
          ))}
        </select>
      </div>
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

      {deleteState?.status === 'error' && deleteState.message ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {deleteState.message}
        </div>
      ) : null}

      <form action={uploadFormAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {hasSelection ? (
          <input type="hidden" name="employeeId" value={selectedEmployeeId ?? ''} />
        ) : null}
        <h2 className="text-lg font-semibold text-slate-900">Dokument hochladen</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span>Dokumenttyp</span>
            <select
              name="documentType"
              value={documentTypeKey}
              onMouseDown={(event) => {
                if (!hasSelection) {
                  setDocumentTypeWarning('Bitte erst Mitarbeiter auswählen.');
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              onFocus={(event) => {
                if (!hasSelection) {
                  setDocumentTypeWarning('Bitte erst Mitarbeiter auswählen.');
                  event.target.blur();
                }
              }}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (!hasSelection) {
                  setDocumentTypeWarning('Bitte erst Mitarbeiter auswählen.');
                  return;
                }
                setDocumentTypeWarning(null);
                setDocumentTypeKey(nextValue);
              }}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="" disabled>
                – bitte wählen –
              </option>
              {documentTypes.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}
                </option>
              ))}
            </select>
            {documentTypeWarning ? (
              <span className="text-xs font-semibold text-red-600">{documentTypeWarning}</span>
            ) : null}
            {previewName ? (
              <span className="text-xs text-slate-500">Geplanter Dateiname: {previewName}</span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span>Datei</span>
            <input
              type="file"
              name="file"
              accept={extensionList}
              required
              disabled={uploadDisabled}
              className="rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
            <span className="text-xs text-slate-500">Zulässige Formate: {extensionList}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="sendMail"
              className="h-4 w-4"
              checked={sendMail}
              onChange={(event) => {
                const checked = event.target.checked;
                setSendMail(checked);
                if (!checked) {
                  setSendAttachment(false);
                } else if (documentTypeKey && currentType && !currentType.sensitive) {
                  setSendAttachment(true);
                }
              }}
              disabled={uploadDisabled || !documentTypeKey}
            />
            Mitarbeitenden per E-Mail informieren (falls E-Mail hinterlegt)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="mailAttachment"
              className="h-4 w-4"
              checked={sendMail && sendAttachment}
              onChange={(event) => setSendAttachment(event.target.checked)}
              disabled={uploadDisabled || !sendMail || !currentType || currentType.sensitive}
            />
            Datei als Anhang mitsenden
          </label>
        </div>
        <UploadButton disabled={uploadDisabled} disabledReason={!hasSelection ? "Bitte erst Mitarbeiter auswählen." : undefined} />
        {!hasSelection ? (
          <p className="text-xs text-slate-500">Bitte zuerst eine Mitarbeiterin bzw. einen Mitarbeiter auswählen.</p>
        ) : null}
      </form>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Neue Mitarbeiter-Uploads</h2>
            <p className="text-sm text-slate-500">
              Alle noch nicht angesehenen Dokumente, die von Mitarbeitenden hochgeladen wurden. Nach dem Öffnen dieser
              Seite werden sie automatisch als gesehen markiert.
            </p>
          </div>
          <span className="text-xs text-slate-400">Ungelesen: {overviewDocuments.length}</span>
        </header>
        {unseenOverview.length ? (
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Mitarbeiter</th>
                  <th className="px-4 py-2">Datei</th>
                  <th className="px-4 py-2">Typ</th>
                  <th className="px-4 py-2">Quelle</th>
                  <th className="px-4 py-2">Größe</th>
                  <th className="px-4 py-2">Hochgeladen</th>
                  <th className="px-4 py-2">E-Mail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {unseenOverview.map((entry) => {
                  const mailStatus = describeMailStatus(entry.document.mailLog);
                  const mailToneClass =
                    mailStatus.tone === 'success'
                      ? 'text-emerald-700'
                      : mailStatus.tone === 'error'
                        ? 'text-red-600'
                        : mailStatus.tone === 'warning'
                          ? 'text-amber-600'
                          : 'text-slate-500';

                  return (
                    <tr key={`${entry.employeeId}-${entry.document.fileName}`}>
                      <td className="px-4 py-2 text-slate-700">
                        <span className="font-medium text-slate-900">{entry.employeeName}</span>
                        <span className="block text-xs text-slate-400">{entry.employeeUsername}</span>
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-800">{entry.document.originalName}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {entry.document.documentType !== 'unknown'
                          ? documentTypeMap.get(entry.document.documentType)?.label ?? entry.document.documentType
                          : '–'}
                      </td>
                      <td className="px-4 py-2 text-slate-600">Mitarbeiter</td>
                      <td className="px-4 py-2 text-slate-600">{formatSize(entry.document.size)}</td>
                      <td className="px-4 py-2 text-slate-600">{formatDate(entry.document.uploadedAt)}</td>
                      <td className={`px-4 py-2 text-xs ${mailToneClass}`}>
                        <div className="flex flex-col gap-0.5">
                          <span>{mailStatus.label}</span>
                          {mailStatus.detail ? (
                            <span className="text-[10px] text-slate-400">{mailStatus.detail}</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Aktuell liegen keine neuen Mitarbeiter-Uploads vor.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          {selectedEmployee
            ? `Dokumente von ${selectedEmployee.name}`
            : 'Bitte Mitarbeitende auswählen'}
        </h2>
        {!hasSelection ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Wähle zunächst eine Mitarbeiterin bzw. einen Mitarbeiter, um die zugehörigen Dokumente anzuzeigen.
          </p>
        ) : !documents.length ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Es sind noch keine Dokumente vorhanden.
          </p>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">
              <header>
                <h3 className="text-base font-semibold text-slate-900">Vom Mitarbeiter hochgeladen</h3>
                <p className="text-xs text-slate-500">Uploads direkt aus dem Mitarbeiterportal.</p>
              </header>
              {employeeDocuments.length ? (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2">Datei</th>
                        <th className="px-4 py-2">Typ</th>
                        <th className="px-4 py-2">Größe</th>
                        <th className="px-4 py-2">Hochgeladen</th>
                        <th className="px-4 py-2">E-Mail</th>
                        <th className="px-4 py-2">Aktionen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {employeeDocuments.map((doc) => {
                        const downloadHref = `${downloadBase}/${encodeURIComponent(doc.fileName)}`;
                        const typeLabel =
                          doc.documentType !== 'unknown'
                            ? documentTypeMap.get(doc.documentType)?.label ?? doc.documentType
                            : '–';
                        const mailStatus = describeMailStatus(doc.mailLog);
                        const mailToneClass =
                          mailStatus.tone === 'success'
                            ? 'text-emerald-700'
                            : mailStatus.tone === 'error'
                              ? 'text-red-600'
                              : mailStatus.tone === 'warning'
                                ? 'text-amber-600'
                                : 'text-slate-500';

                        return (
                          <tr key={doc.fileName}>
                            <td className="px-4 py-2 font-medium text-slate-800">{doc.originalName}</td>
                            <td className="px-4 py-2 text-slate-600">{typeLabel}</td>
                            <td className="px-4 py-2 text-slate-600">{formatSize(doc.size)}</td>
                            <td className="px-4 py-2 text-slate-600">{formatDate(doc.uploadedAt)}</td>
                            <td className={`px-4 py-2 text-xs ${mailToneClass}`}>
                              <div className="flex flex-col gap-0.5">
                                <span>{mailStatus.label}</span>
                                {mailStatus.detail ? (
                                  <span className="text-[10px] text-slate-400">{mailStatus.detail}</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-slate-600">
                              <div className="flex flex-wrap items-center gap-2">
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
                                <form action={deleteFormAction} className="inline-flex items-center gap-2">
                                  <input type="hidden" name="employeeId" value={selectedEmployeeId ?? ''} />
                                  <input type="hidden" name="fileName" value={doc.fileName} />
                                  <DeleteButton />
                                </form>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Keine Dokumente direkt vom Mitarbeitenden.
                </p>
              )}
            </section>

            <section className="space-y-3">
              <header>
                <h3 className="text-base font-semibold text-slate-900">Vom Admin bereitgestellt</h3>
                <p className="text-xs text-slate-500">Dokumente, die über dieses Backend hochgeladen wurden.</p>
              </header>
              {adminDocuments.length ? (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2">Datei</th>
                        <th className="px-4 py-2">Typ</th>
                        <th className="px-4 py-2">Größe</th>
                        <th className="px-4 py-2">Hochgeladen</th>
                        <th className="px-4 py-2">E-Mail</th>
                        <th className="px-4 py-2">Aktionen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {adminDocuments.map((doc) => {
                        const downloadHref = `${downloadBase}/${encodeURIComponent(doc.fileName)}`;
                        const typeLabel =
                          doc.documentType !== 'unknown'
                            ? documentTypeMap.get(doc.documentType)?.label ?? doc.documentType
                            : '–';
                        const mailStatus = describeMailStatus(doc.mailLog);
                        const mailToneClass =
                          mailStatus.tone === 'success'
                            ? 'text-emerald-700'
                            : mailStatus.tone === 'error'
                              ? 'text-red-600'
                              : mailStatus.tone === 'warning'
                                ? 'text-amber-600'
                                : 'text-slate-500';

                        return (
                          <tr key={doc.fileName}>
                            <td className="px-4 py-2 font-medium text-slate-800">{doc.originalName}</td>
                            <td className="px-4 py-2 text-slate-600">{typeLabel}</td>
                            <td className="px-4 py-2 text-slate-600">{formatSize(doc.size)}</td>
                            <td className="px-4 py-2 text-slate-600">{formatDate(doc.uploadedAt)}</td>
                            <td className={`px-4 py-2 text-xs ${mailToneClass}`}>
                              <div className="flex flex-col gap-0.5">
                                <span>{mailStatus.label}</span>
                                {mailStatus.detail ? (
                                  <span className="text-[10px] text-slate-400">{mailStatus.detail}</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-slate-600">
                              <div className="flex flex-wrap items-center gap-2">
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
                                <form action={deleteFormAction} className="inline-flex items-center gap-2">
                                  <input type="hidden" name="employeeId" value={selectedEmployeeId ?? ''} />
                                  <input type="hidden" name="fileName" value={doc.fileName} />
                                  <DeleteButton />
                                </form>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  Keine Admin-Dokumente vorhanden.
                </p>
              )}
            </section>
          </div>
        )}
      </section>
    </section>
  );
}
