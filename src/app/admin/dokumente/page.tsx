import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  getAdminDocumentTypes,
  getEmployeeOptionsForAdmin,
  listEmployeeDocuments,
  listUnseenEmployeeDocuments,
  markAdminEmployeeDocumentsAsSeen,
  type AdminDocumentTypeOption,
  type DocumentInfo,
  type AdminDocumentOverviewEntry,
} from '@/lib/services/documents';

import AdminDocumentsPanel from './AdminDocumentsPanel';
import { adminDeleteDocumentAction, adminUploadDocumentAction, ensureAdmin } from './actions';
import type { AdminDeleteState, AdminUploadState } from './types';

const INITIAL_UPLOAD_STATE: AdminUploadState = {};
const INITIAL_DELETE_STATE: AdminDeleteState = {};

export default async function AdminDokumentePage({
  searchParams,
}: {
  searchParams?: Promise<{ employeeId?: string }>;
}) {
  const session = await getServerAuthSession();
  const tenantId = await ensureAdmin(session);
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

  const resolvedSearchParams = await searchParams;
  const requestedIdRaw = resolvedSearchParams?.employeeId ?? '';
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
      allowedExtensions={ALLOWED_DOCUMENT_EXTENSIONS}
      documentTypes={documentTypes as AdminDocumentTypeOption[]}
      overviewDocuments={overviewDocuments as AdminDocumentOverviewEntry[]}
      uploadAction={adminUploadDocumentAction}
      uploadInitialState={INITIAL_UPLOAD_STATE}
      deleteAction={adminDeleteDocumentAction}
      deleteInitialState={INITIAL_DELETE_STATE}
    />
  );
}
