import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  listEmployeeDocuments,
  notifyAdminAboutEmployeeUpload,
  saveEmployeeDocumentFromFile,
  type DocumentInfo,
} from '@/lib/services/documents';

import EmployeeDocumentsPanel from './EmployeeDocumentsPanel';

export type UploadState = {
  status?: 'success' | 'error';
  message?: string;
};

function ensureEmployee(session: Awaited<ReturnType<typeof getServerAuthSession>>) {
  if (!session?.user) {
    redirect(withAppBasePath('/login?mode=employee'));
  }
  if (!session.user.employeeId) {
    redirect(withAppBasePath('/admin'));
  }
  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login?mode=employee'));
  }
  return { employeeId: session.user.employeeId, tenantId };
}

const INITIAL_UPLOAD_STATE: UploadState = {};

export async function uploadDocumentAction(
  prevState: UploadState,
  formData: FormData
): Promise<UploadState> {
  'use server';

  const session = await getServerAuthSession();
  const { employeeId, tenantId } = ensureEmployee(session);

  const entry = formData.get('file');
  if (!(entry instanceof File) || !entry.size) {
    return {
      status: 'error',
      message: 'Bitte wähle eine Datei aus.',
    };
  }

  try {
    const result = await saveEmployeeDocumentFromFile(employeeId, entry);
    await notifyAdminAboutEmployeeUpload(tenantId, employeeId, result.storedFileName);
    revalidatePath(withAppBasePath('/mitarbeiter/dokumente'));
    return {
      status: 'success',
      message: 'Dokument wurde hochgeladen.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload fehlgeschlagen.';
    return {
      status: 'error',
      message,
    };
  }
}

export default async function MitarbeiterDokumentePage() {
  const session = await getServerAuthSession();
  const { employeeId } = ensureEmployee(session);
  const documents = listEmployeeDocuments(employeeId);

  return (
    <EmployeeDocumentsPanel
      employeeId={employeeId}
      documents={documents as DocumentInfo[]}
      uploadAction={uploadDocumentAction}
      initialUploadState={INITIAL_UPLOAD_STATE}
      allowedExtensions={ALLOWED_DOCUMENT_EXTENSIONS as string[]}
    />
  );
}
