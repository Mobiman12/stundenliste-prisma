import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';

import { getAdminDocumentLastSeen, markAdminDocumentsSeen } from '@/lib/data/admin-document-seen';
import { getEmployeeById, listEmployees } from '@/lib/data/employees';
import { sendMail, sendTextMail, type MailAttachment } from '@/lib/services/email';

export const ALLOWED_DOCUMENT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'] as const;
const MAX_DOCUMENT_SIZE_BYTES = Number.parseInt(process.env.MAX_DOCUMENT_SIZE ?? '10485760', 10); // 10 MB default

export type AllowedExtension = (typeof ALLOWED_DOCUMENT_EXTENSIONS)[number];

export type DocumentTypeKey = 'general' | 'payroll' | 'salary' | 'settlement';

type DocumentTypeDefinition = {
  key: DocumentTypeKey;
  label: string;
  slug: string;
  sensitive: boolean;
  forcePreviousMonth: boolean;
};

const DOCUMENT_TYPES: DocumentTypeDefinition[] = [
  { key: 'general', label: 'Allgemein', slug: 'allgemein', sensitive: false, forcePreviousMonth: false },
  { key: 'payroll', label: 'Lohnzettel', slug: 'lohnzettel', sensitive: true, forcePreviousMonth: true },
  { key: 'salary', label: 'Gehaltsabrechnung', slug: 'gehaltsabrechnung', sensitive: true, forcePreviousMonth: true },
  { key: 'settlement', label: 'Abrechnung', slug: 'abrechnung', sensitive: true, forcePreviousMonth: false },
];

const DOCUMENT_TYPE_MAP = new Map<DocumentTypeKey, DocumentTypeDefinition>(
  DOCUMENT_TYPES.map((definition) => [definition.key, definition])
);

export const SENSITIVE_DOCUMENT_TYPES = DOCUMENT_TYPES.filter((definition) => definition.sensitive).map(
  (definition) => definition.key
);

export type DocumentMailLog = {
  status: 'sent' | 'failed' | 'skipped';
  sentAt: string | null;
  withAttachment: boolean;
  subject: string;
  recipient: string;
  error?: string | null;
};

export type UploadedBy = 'employee' | 'admin';

export type DocumentInfo = {
  fileName: string;
  originalName: string;
  size: number;
  uploadedAt: string; // ISO string
  extension: AllowedExtension | 'unknown';
  documentType: DocumentTypeKey | 'unknown';
  uploadedBy: UploadedBy;
  mailLog: DocumentMailLog | null;
};

export type AdminDocumentTypeOption = {
  key: DocumentTypeKey;
  label: string;
  slug: string;
  sensitive: boolean;
  forcePreviousMonth: boolean;
};

export type SaveDocumentResult = {
  storedFileName: string;
  size: number;
  uploadedAt: string;
  fullPath?: string;
};

export type AdminSaveDocumentResult = SaveDocumentResult & {
  documentType: DocumentTypeKey;
};

export type AdminDocumentOverviewEntry = {
  employeeId: number;
  employeeName: string;
  employeeUsername: string;
  document: DocumentInfo;
};

export type DocumentSummary = {
  total: number;
  totalBySource: Record<UploadedBy, number>;
  employeeUploads: number;
  adminUploads: number;
};

const MAIL_LOG_SUFFIX = '.mail.json';
const PORTAL_HINT = process.env.APP_BASE_URL?.trim();

function toIsoString(date: Date): string {
  return DateTime.fromJSDate(date).toISO() ?? date.toISOString();
}

function getUploadRoot(): string {
  const configured = process.env.UPLOAD_ROOT;
  const root = configured ? path.resolve(configured) : path.resolve(process.cwd(), '..', 'uploads');
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return root;
}

function getEmployeeDir(employeeId: number): string {
  const root = getUploadRoot();
  const dir = path.join(root, `employee_${employeeId}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename);
  const replaced = base.replace(/[^a-zA-Z0-9_.\-]/g, '_');
  return replaced.length ? replaced : 'datei';
}

function ensureAllowedExtension(filename: string): AllowedExtension {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(ext as AllowedExtension)) {
    throw new Error(`Unzulässige Dateiendung: ${ext || '(leer)'}`);
  }
  return ext as AllowedExtension;
}

function buildEmployeeStoredFileName(originalName: string): { storedName: string; extension: AllowedExtension } {
  const sanitized = sanitizeFilename(originalName);
  const extension = ensureAllowedExtension(sanitized);
  const timestamp = DateTime.now().toFormat('yyyyLLdd_HHmmss');
  return {
    storedName: `${timestamp}__${sanitized}`,
    extension,
  };
}

function getDocumentTypeDefinition(key: DocumentTypeKey): DocumentTypeDefinition {
  const definition = DOCUMENT_TYPE_MAP.get(key);
  if (!definition) {
    throw new Error(`Unbekannter Dokumenttyp: ${key}`);
  }
  return definition;
}

function getDocumentTypeBySlug(slug: string): DocumentTypeDefinition | undefined {
  return DOCUMENT_TYPES.find((definition) => definition.slug === slug);
}

function uniqueFileName(dir: string, base: string, extension: string): string {
  let candidate = `${base}${extension}`;
  let counter = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}_${counter}${extension}`;
    counter += 1;
  }
  return candidate;
}

function buildAdminStoredFileName(
  dir: string,
  definition: DocumentTypeDefinition,
  originalName: string
): { storedName: string; extension: AllowedExtension } {
  const sanitized = sanitizeFilename(originalName);
  const extension = ensureAllowedExtension(sanitized);
  const now = DateTime.now();
  const date = definition.forcePreviousMonth ? now.minus({ months: 1 }) : now;
  const base = `${definition.slug}_${date.toFormat('LLyyyy')}`;
  const storedName = uniqueFileName(dir, base, `.${extension}`);
  return {
    storedName,
    extension,
  };
}

function extractSlug(storedName: string): string {
  const base = path.basename(storedName);
  const [firstPart] = base.split('_');
  return firstPart ?? '';
}

function detectUploadedBy(storedName: string): UploadedBy {
  return storedName.includes('__') ? 'employee' : 'admin';
}

export function detectDocumentType(storedName: string): DocumentTypeKey | 'unknown' {
  const slug = extractSlug(storedName).toLowerCase();
  const definition = getDocumentTypeBySlug(slug);
  return definition ? definition.key : 'unknown';
}

export function extractOriginalName(storedName: string): string {
  const separatorIndex = storedName.indexOf('__');
  if (separatorIndex === -1) {
    return storedName;
  }
  return storedName.slice(separatorIndex + 2) || storedName;
}

function getMailLogPath(fullPath: string): string {
  return `${fullPath}${MAIL_LOG_SUFFIX}`;
}

function writeMailLog(fullPath: string, log: DocumentMailLog): void {
  try {
    fs.writeFileSync(getMailLogPath(fullPath), JSON.stringify(log, null, 2), { encoding: 'utf-8' });
  } catch (error) {
    console.error('Mail-Log konnte nicht geschrieben werden:', error);
  }
}

function readMailLog(fullPath: string): DocumentMailLog | null {
  const logPath = getMailLogPath(fullPath);
  if (!fs.existsSync(logPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(logPath, { encoding: 'utf-8' });
    const parsed = JSON.parse(raw) as DocumentMailLog;
    return parsed;
  } catch (error) {
    console.error('Mail-Log konnte nicht gelesen werden:', error);
    return null;
  }
}

function removeMailLog(fullPath: string): void {
  const logPath = getMailLogPath(fullPath);
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
  }
}

export function summarizeEmployeeDocuments(employeeId: number): DocumentSummary {
  const documents = listEmployeeDocuments(employeeId);
  const totalBySource: Record<UploadedBy, number> = {
    admin: 0,
    employee: 0,
  };

  for (const doc of documents) {
    totalBySource[doc.uploadedBy] += 1;
  }

  return {
    total: documents.length,
    totalBySource,
    adminUploads: totalBySource.admin,
    employeeUploads: totalBySource.employee,
  };
}

export function listEmployeeDocuments(employeeId: number): DocumentInfo[] {
  const dir = getEmployeeDir(employeeId);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const docs: DocumentInfo[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fileName = entry.name;
    if (fileName.endsWith(MAIL_LOG_SUFFIX)) continue;

    const fullPath = path.join(dir, fileName);
    try {
      const extension = ensureAllowedExtension(fileName);
      const stats = fs.statSync(fullPath);
      docs.push({
        fileName,
        originalName: extractOriginalName(fileName),
        size: stats.size,
        uploadedAt: toIsoString(stats.mtime),
        extension,
        documentType: detectDocumentType(fileName),
        uploadedBy: detectUploadedBy(fileName),
        mailLog: readMailLog(fullPath),
      });
    } catch {
      continue;
    }
  }

  docs.sort((a, b) => (a.uploadedAt > b.uploadedAt ? -1 : 1));
  return docs;
}

export async function saveEmployeeDocumentFromFile(
  employeeId: number,
  file: File
): Promise<SaveDocumentResult> {
  if (file.size === 0) {
    throw new Error('Die ausgewählte Datei ist leer.');
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error('Die Datei ist zu groß.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return saveEmployeeDocumentFromBuffer(employeeId, buffer, file.name);
}

export async function saveEmployeeDocumentFromBuffer(
  employeeId: number,
  buffer: Buffer,
  originalName: string
): Promise<SaveDocumentResult> {
  const dir = getEmployeeDir(employeeId);
  const { storedName } = buildEmployeeStoredFileName(originalName);
  const fullPath = path.join(dir, storedName);

  fs.writeFileSync(fullPath, buffer);

  const stats = fs.statSync(fullPath);
  return {
    storedFileName: storedName,
    size: stats.size,
    uploadedAt: toIsoString(stats.mtime),
  };
}

export async function saveAdminDocumentFromFile(options: {
  tenantId: string;
  employeeId: number;
  file: File;
  documentType: DocumentTypeKey;
  contexts?: string[];
}): Promise<AdminSaveDocumentResult> {
  const employee = await getEmployeeById(options.tenantId, options.employeeId);
  if (!employee) {
    throw new Error('Mitarbeiter wurde nicht gefunden.');
  }
  if (options.file.size === 0) {
    throw new Error('Die ausgewählte Datei ist leer.');
  }
  if (options.file.size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error('Die Datei ist zu groß.');
  }
  const buffer = Buffer.from(await options.file.arrayBuffer());
  return saveAdminDocumentFromBuffer({
    employeeId: options.employeeId,
    buffer,
    originalName: options.file.name,
    documentType: options.documentType,
  });
}

export function saveAdminDocumentFromBuffer(options: {
  employeeId: number;
  buffer: Buffer;
  originalName: string;
  documentType: DocumentTypeKey;
}): AdminSaveDocumentResult {
  const dir = getEmployeeDir(options.employeeId);
  const definition = getDocumentTypeDefinition(options.documentType);
  const { storedName } = buildAdminStoredFileName(dir, definition, options.originalName);
  const fullPath = path.join(dir, storedName);

  fs.writeFileSync(fullPath, options.buffer);

  const stats = fs.statSync(fullPath);
  return {
    storedFileName: storedName,
    size: stats.size,
    uploadedAt: toIsoString(stats.mtime),
    fullPath,
    documentType: options.documentType,
  };
}

export function deleteEmployeeDocument(employeeId: number, fileName: string): void {
  const dir = getEmployeeDir(employeeId);
  const sanitized = path.basename(fileName);
  ensureAllowedExtension(sanitized);
  const fullPath = path.join(dir, sanitized);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
  removeMailLog(fullPath);
}

export function getEmployeeDocumentPath(employeeId: number, fileName: string): string {
  const dir = getEmployeeDir(employeeId);
  const sanitized = path.basename(fileName);
  ensureAllowedExtension(sanitized);
  const fullPath = path.join(dir, sanitized);
  if (!fs.existsSync(fullPath)) {
    throw new Error('Dokument nicht gefunden.');
  }
  return fullPath;
}

export async function notifyAdminAboutEmployeeUpload(
  tenantId: string,
  employeeId: number,
  fileName: string
) {
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (!adminEmail) return;
  const employee = await getEmployeeById(tenantId, employeeId);
  if (!employee) return;

  const subject = `Neues Dokument von ${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim();
  const body =
    `Mitarbeiter ${employee.first_name ?? ''} ${employee.last_name ?? ''} (ID ${employee.id}) ` +
    `hat das Dokument "${extractOriginalName(fileName)}" hochgeladen.`;
  try {
    await sendTextMail(adminEmail, subject, body);
  } catch (error) {
    console.error('Fehler beim Senden der Admin-Benachrichtigung:', error);
  }
}

export async function notifyEmployeeAboutAdminUpload(tenantId: string, options: {
  employeeId: number;
  storedFileName: string;
  documentType: DocumentTypeKey;
  attachFile: boolean;
}): Promise<DocumentMailLog> {
  const employee = await getEmployeeById(tenantId, options.employeeId);
  if (!employee?.email) {
    return {
      status: 'skipped',
      sentAt: null,
      withAttachment: false,
      subject: '(kein Versand – keine E-Mail-Adresse)',
      recipient: '',
      error: 'Keine E-Mail-Adresse hinterlegt.',
    };
  }

  const definition = getDocumentTypeDefinition(options.documentType);
  const storedPath = getEmployeeDocumentPath(options.employeeId, options.storedFileName);

  const now = DateTime.now().toISO();
  const documentLabel = extractOriginalName(options.storedFileName);
  const portalReference = PORTAL_HINT ? `\n\nPortal: ${PORTAL_HINT}` : '';

  const subject = definition.sensitive
    ? 'Neues vertrauliches Dokument in deinem Mitarbeiterkonto'
    : 'Neues Dokument in deinem Mitarbeiterkonto';

  const baseBody =
    `Hallo ${employee.first_name ?? employee.username},\n\n` +
    `es wurde ein neues Dokument (${documentLabel}) in deinem Mitarbeiterkonto hinterlegt (Typ: ${definition.label}).\n` +
    `Datum: ${DateTime.now().setLocale('de').toFormat('dd.LL.yyyy HH:mm')}\n\n` +
    'Bitte logge dich ein, um das Dokument einzusehen.' +
    portalReference +
    '\n\nBeste Grüße\nDein Admin-Team';

  if (definition.sensitive) {
    try {
      await sendTextMail(employee.email, subject, baseBody);
      return {
        status: 'sent',
        sentAt: now,
        withAttachment: false,
        subject,
        recipient: employee.email,
      };
    } catch (error) {
      return {
        status: 'failed',
        sentAt: now,
        withAttachment: false,
        subject,
        recipient: employee.email,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (!options.attachFile) {
    try {
      await sendTextMail(employee.email, subject, baseBody);
      return {
        status: 'sent',
        sentAt: now,
        withAttachment: false,
        subject,
        recipient: employee.email,
      };
    } catch (error) {
      return {
        status: 'failed',
        sentAt: now,
        withAttachment: false,
        subject,
        recipient: employee.email,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  try {
    const attachment: MailAttachment = {
      filename: documentLabel,
      content: fs.readFileSync(storedPath),
    };
    await sendMail({
      to: employee.email,
      subject,
      text: baseBody,
      attachments: [attachment],
    });
    return {
      status: 'sent',
      sentAt: now,
      withAttachment: true,
      subject,
      recipient: employee.email,
    };
  } catch (error) {
    return {
      status: 'failed',
      sentAt: now,
      withAttachment: options.attachFile,
      subject,
      recipient: employee.email,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getEmployeeOptionsForAdmin(tenantId: string) {
  const employees = await listEmployees(tenantId);
  return employees.map((emp) => ({
    id: emp.id,
    name: emp.displayName,
    email: emp.username,
  }));
}

export async function listAllEmployeeDocuments(tenantId: string): Promise<AdminDocumentOverviewEntry[]> {
  const employees = await listEmployees(tenantId, { includeInactive: true });
  const rows: AdminDocumentOverviewEntry[] = [];

  for (const employee of employees) {
    const documents = listEmployeeDocuments(employee.id);
    for (const document of documents) {
      rows.push({
        employeeId: employee.id,
        employeeName: employee.displayName,
        employeeUsername: employee.username,
        document,
      });
    }
  }

  rows.sort((a, b) => (a.document.uploadedAt > b.document.uploadedAt ? -1 : 1));
  return rows;
}

export function recordDocumentMailLog(employeeId: number, fileName: string, log: DocumentMailLog): void {
  try {
    const fullPath = getEmployeeDocumentPath(employeeId, fileName);
    writeMailLog(fullPath, log);
  } catch (error) {
    console.error('Mail-Log konnte nicht gespeichert werden:', error);
  }
}

export function getAdminDocumentTypes(): AdminDocumentTypeOption[] {
  return DOCUMENT_TYPES.map(({ key, label, slug, sensitive, forcePreviousMonth }) => ({
    key,
    label,
    slug,
    sensitive,
    forcePreviousMonth,
  }));
}

export function isSensitiveDocumentType(documentType: DocumentTypeKey): boolean {
  return getDocumentTypeDefinition(documentType).sensitive;
}

export function documentTypeAllowsAttachment(documentType: DocumentTypeKey): boolean {
  return !getDocumentTypeDefinition(documentType).sensitive;
}

export function getAdminDocumentPreviewName(
  documentType: DocumentTypeKey,
  extension: AllowedExtension = 'pdf'
): string {
  const definition = getDocumentTypeDefinition(documentType);
  const now = DateTime.now();
  const date = definition.forcePreviousMonth ? now.minus({ months: 1 }) : now;
  return `${definition.slug}_${date.toFormat('LLyyyy')}.${extension}`;
}

export async function listUnseenEmployeeDocuments(
  tenantId: string,
  adminId: number
): Promise<AdminDocumentOverviewEntry[]> {
  if (!Number.isFinite(adminId) || adminId <= 0) {
    return [];
  }

  const lastSeen = await getAdminDocumentLastSeen(tenantId, adminId);
  const employees = await listEmployees(tenantId, { includeInactive: true });
  const unseen: AdminDocumentOverviewEntry[] = [];

  for (const employee of employees) {
    const documents = listEmployeeDocuments(employee.id);
    for (const document of documents) {
      if (document.uploadedBy !== 'employee') {
        continue;
      }

      const uploadedAt = Date.parse(document.uploadedAt);
      if (!Number.isFinite(uploadedAt)) {
        continue;
      }

      if (uploadedAt <= lastSeen) {
        continue;
      }

      unseen.push({
        employeeId: employee.id,
        employeeName: employee.displayName,
        employeeUsername: employee.username,
        document,
      });
    }
  }

  unseen.sort((a, b) => (a.document.uploadedAt > b.document.uploadedAt ? -1 : 1));
  return unseen;
}

export async function countUnseenEmployeeDocuments(tenantId: string, adminId: number): Promise<number> {
  const list = await listUnseenEmployeeDocuments(tenantId, adminId);
  return list.length;
}

export async function markAdminEmployeeDocumentsAsSeen(
  tenantId: string,
  adminId: number,
  documents: AdminDocumentOverviewEntry[]
): Promise<void> {
  if (!Number.isFinite(adminId) || adminId <= 0) {
    return;
  }

  let latest = 0;
  for (const entry of documents) {
    if (entry.document.uploadedBy !== 'employee') {
      continue;
    }
    const timestamp = Date.parse(entry.document.uploadedAt);
    if (!Number.isFinite(timestamp)) {
      continue;
    }
    if (timestamp > latest) {
      latest = timestamp;
    }
  }

  if (latest <= 0) {
    return;
  }

  await markAdminDocumentsSeen(tenantId, adminId, latest);
}
