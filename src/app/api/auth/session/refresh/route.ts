import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE, createTeamSessionToken, verifyTeamSession } from '@/lib/team-session';

const SESSION_TTL_MS = 1000 * 60 * 15;

export async function POST(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('mode');
  if (mode !== 'employee' && mode !== 'admin') {
    return NextResponse.json({ ok: false, reason: 'invalid_mode' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SESSION_COOKIE)?.value ?? null;
  const session = await verifyTeamSession(cookieValue);
  if (!session) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  const expiresMs = Date.now() + SESSION_TTL_MS;
  const token = await createTeamSessionToken({
    ...session,
    expiresAt: expiresMs,
  });

  const response = NextResponse.json({ ok: true, expiresAt: expiresMs });
  const cookieDomain = process.env.TEAM_SESSION_COOKIE_DOMAIN?.trim() || undefined;
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresMs),
    secure: process.env.NODE_ENV === 'production',
    domain: cookieDomain,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
