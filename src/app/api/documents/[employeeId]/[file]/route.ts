import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

import { getServerAuthSession } from '@/lib/auth/session';
import { getEmployeeDocumentPath, extractOriginalName } from '@/lib/services/documents';

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ employeeId: string; file: string }> }
) {
  const { employeeId, file } = await params;
  const session = await getServerAuthSession();
  if (!session?.user) {
    return new NextResponse('Nicht angemeldet', { status: 401 });
  }

  const employeeIdNumber = Number.parseInt(employeeId, 10);
  if (!Number.isFinite(employeeIdNumber) || employeeIdNumber <= 0) {
    return new NextResponse('Ungültige Mitarbeiter-ID', { status: 400 });
  }

  if (session.user.roleId !== 2 && session.user.employeeId !== employeeIdNumber) {
    return new NextResponse('Keine Berechtigung', { status: 403 });
  }

  const requestedFile = decodeURIComponent(file);
  try {
    const fullPath = getEmployeeDocumentPath(employeeIdNumber, requestedFile);
    const fileBuffer = fs.readFileSync(fullPath);
    const extension = path.extname(fullPath).replace('.', '').toLowerCase();
    const contentType = CONTENT_TYPES[extension] ?? 'application/octet-stream';
    const originalName = extractOriginalName(requestedFile);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(originalName)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Dokumentabruf fehlgeschlagen:', error);
    return new NextResponse('Dokument nicht gefunden', { status: 404 });
  }
}
