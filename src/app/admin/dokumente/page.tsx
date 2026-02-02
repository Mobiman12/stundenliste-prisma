import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  deleteEmployeeDocument,
  documentTypeAllowsAttachment,
  getAdminDocumentTypes,
  getEmployeeOptionsForAdmin,
  listEmployeeDocuments,
  listUnseenEmployeeDocuments,
  markAdminEmployeeDocumentsAsSeen,
  notifyEmployeeAboutAdminUpload,
  recordDocumentMailLog,
  saveAdminDocumentFromFile,
  type AdminDocumentTypeOption,
  type DocumentInfo,
  type DocumentMailLog,
  type AdminDocumentOverviewEntry,
} from '@/lib/services/documents';
import type { DocumentTypeKey } from '@/lib/services/documents';

import AdminDocumentsPanel from './AdminDocumentsPanel';

export type AdminUploadState = {
  status?: 'success' | 'error';
  message?: string;
};

export type AdminDeleteState = {
  status?: 'success' | 'error';
  message?: string;
};

const INITIAL_UPLOAD_STATE: AdminUploadState = {};
const INITIAL_DELETE_STATE: AdminDeleteState = {};

function ensureAdmin(session: Awaited<ReturnType<typeof getServerAuthSession>>): string {
  if (!session?.user) {
    redirect(withAppBasePath('/login'));
  }
  if (session.user.roleId !== 2) {
    redirect(withAppBasePath('/mitarbeiter'));
  }
  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login'));
  }
  return tenantId;
}

export async function adminUploadDocumentAction(
  prevState: AdminUploadState,
  formData: FormData
): Promise<AdminUploadState> {
  'use server';

  const session = await getServerAuthSession();
  const tenantId = ensureAdmin(session);
  const userId = session?.user?.id;
  if (!userId) {
    redirect(withAppBasePath('/login'));
  }

  const employeeIdRaw = formData.get('employeeId');
  const employeeId = Number.parseInt(String(employeeIdRaw ?? ''), 10);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return {
      status: 'error',
      message: 'Ungültige Mitarbeiter-ID.',
    };
  }

  const fileEntry = formData.get('file');
  if (!(fileEntry instanceof File) || !fileEntry.size) {
    return {
      status: 'error',
      message: 'Bitte wähle eine Datei aus.',
    };
  }

  const documentTypeRaw = String(formData.get('documentType') ?? '');
  const documentType = documentTypeRaw as DocumentTypeKey;
  const documentTypes = getAdminDocumentTypes();
  const selectedType = documentTypes.find((option) => option.key === documentType);
  if (!selectedType) {
    return {
      status: 'error',
      message: 'Ungültiger Dokumenttyp.',
    };
  }

  const sendMail = formData.get('sendMail') === 'on';
  const attachRequested = formData.get('mailAttachment') === 'on';
  const allowAttachment = documentTypeAllowsAttachment(documentType);
  const attachFile = sendMail && allowAttachment && attachRequested;

  try {
    const result = await saveAdminDocumentFromFile({
      tenantId,
      employeeId,
      file: fileEntry,
      documentType,
    });

    let mailLog: DocumentMailLog;
    if (sendMail) {
      mailLog = await notifyEmployeeAboutAdminUpload(tenantId, {
        employeeId,
        storedFileName: result.storedFileName,
        documentType,
        attachFile,
      });
    } else {
      mailLog = {
        status: 'skipped',
        sentAt: null,
        withAttachment: false,
        subject: '(kein Versand)',
        recipient: '',
      };
    }

    recordDocumentMailLog(employeeId, result.storedFileName, mailLog);
    revalidatePath(withAppBasePath('/admin/dokumente'));

    if (mailLog.status === 'failed') {
      return {
        status: 'error',
        message: `Dokument gespeichert, aber E-Mail fehlgeschlagen: ${mailLog.error ?? 'Unbekannter Fehler.'}`,
      };
    }

    const message =
      mailLog.status === 'sent'
        ? `Dokument hochgeladen. E-Mail ${mailLog.withAttachment ? 'mit Anhang ' : ''}versendet.`
        : 'Dokument hochgeladen (ohne E-Mail).';

    return {
      status: 'success',
      message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload fehlgeschlagen.';
    return {
      status: 'error',
      message,
    };
  }
}

export async function adminDeleteDocumentAction(
  prevState: AdminDeleteState,
  formData: FormData
): Promise<AdminDeleteState> {
  'use server';

  const session = await getServerAuthSession();
  ensureAdmin(session);

  const employeeIdRaw = formData.get('employeeId');
  const employeeId = Number.parseInt(String(employeeIdRaw ?? ''), 10);
  const fileName = String(formData.get('fileName') ?? '');

  if (!Number.isFinite(employeeId) || employeeId <= 0 || !fileName) {
    return {
      status: 'error',
      message: 'Ungültige Angaben.',
    };
  }

  try {
    deleteEmployeeDocument(employeeId, fileName);
    revalidatePath(withAppBasePath('/admin/dokumente'));
    return {
      status: 'success',
      message: 'Dokument gelöscht.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Löschen fehlgeschlagen.';
    return {
      status: 'error',
      message,
    };
  }
}

export default async function AdminDokumentePage({
  searchParams,
}: {
  searchParams?: { employeeId?: string };
}) {
  const session = await getServerAuthSession();
  const tenantId = ensureAdmin(session);
  const userId = session?.user?.id;
  if (!userId) {
    redirect(withAppBasePath('/login'));
  }

  const employees = await getEmployeeOptionsForAdmin(tenantId);
  if (!employees.length) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Dokumente verwalten</h1>
        <p className="text-sm text-slate-500">Keine Mitarbeitenden gefunden.</p>
      </section>
    );
  }

  const requestedIdRaw = searchParams?.employeeId ?? '';
  const requestedId = requestedIdRaw ? Number.parseInt(requestedIdRaw, 10) : NaN;
  const selectedEmployeeId = Number.isFinite(requestedId) ? requestedId : null;

  const documents = selectedEmployeeId ? listEmployeeDocuments(selectedEmployeeId) : [];
  const documentTypes = getAdminDocumentTypes();
  const overviewDocuments = await listUnseenEmployeeDocuments(tenantId, userId);

  await markAdminEmployeeDocumentsAsSeen(tenantId, userId, overviewDocuments as AdminDocumentOverviewEntry[]);

  return (
    <AdminDocumentsPanel
      employees={employees}
      selectedEmployeeId={selectedEmployeeId}
      documents={documents as DocumentInfo[]}
      allowedExtensions={ALLOWED_DOCUMENT_EXTENSIONS as string[]}
      documentTypes={documentTypes as AdminDocumentTypeOption[]}
      overviewDocuments={overviewDocuments as AdminDocumentOverviewEntry[]}
      uploadAction={adminUploadDocumentAction}
      uploadInitialState={INITIAL_UPLOAD_STATE}
      deleteAction={adminDeleteDocumentAction}
      deleteInitialState={INITIAL_DELETE_STATE}
    />
  );
}
