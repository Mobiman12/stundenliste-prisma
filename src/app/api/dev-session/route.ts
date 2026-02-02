import { NextRequest, NextResponse } from 'next/server';

import { findUserProfileByUsername } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';
import { withAppBasePath } from '@/lib/routes';
import { SESSION_COOKIE, createTeamSessionToken } from '@/lib/team-session';

const isDev = process.env.NODE_ENV !== 'production';

export async function GET(request: NextRequest) {
  console.log('[dev-session] handler invoked', {
    path: request.nextUrl.pathname,
    mode: process.env.NODE_ENV,
  });
  if (!isDev) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const searchParams = request.nextUrl.searchParams;
  const requestedUser = searchParams.get('user');
  const username = requestedUser ?? 'demo';
  const redirectParam = searchParams.get('redirect');
  let profile = await findUserProfileByUsername(username);

  // Backwards-compatible: ältere Dev-Links nutzen oft ?user=Admin oder ?user=demo.
  if (!profile && requestedUser) {
    const normalized = username.trim().toLowerCase();
    if (normalized !== 'admin') {
      profile = await findUserProfileByUsername('Admin');
    }
    if (!profile && normalized !== 'demo') {
      profile = await findUserProfileByUsername('demo');
    }
  }

  if (!profile) {
    return NextResponse.json({ error: `Unknown user "${username}"` }, { status: 404 });
  }

  const prisma = getPrisma();
  const tenantId =
    profile.accountType === 'admin'
      ? (await prisma.admin.findUnique({ where: { id: profile.id }, select: { tenantId: true } }))?.tenantId ?? null
      : (await prisma.employee.findUnique({
          where: { id: profile.employeeId ?? profile.id },
          select: { tenantId: true },
        }))?.tenantId ?? null;

  const expiresMs = Date.now() + 1000 * 60 * 60 * 24;
  const cookieValue = await createTeamSessionToken({
    username: profile.username,
    expiresAt: expiresMs,
    tenantId,
  });

  const origin = request.nextUrl.origin;
  const fallbackRedirect = `${origin}${withAppBasePath('/dashboard', 'external')}`;
  const redirectTarget = redirectParam
    ? (() => {
        try {
          return new URL(redirectParam, origin).toString();
        } catch {
          return fallbackRedirect;
        }
      })()
    : fallbackRedirect;

  const response = NextResponse.redirect(redirectTarget);

  response.cookies.set({
    name: SESSION_COOKIE,
    value: cookieValue,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresMs),
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}
