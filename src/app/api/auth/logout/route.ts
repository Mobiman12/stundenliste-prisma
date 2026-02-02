import { NextRequest, NextResponse } from 'next/server';

import { withAppBasePath } from '@/lib/routes';
import { SESSION_COOKIE } from '@/lib/team-session';

function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    path: '/',
    expires: new Date(0),
  });
}

function resolveLoginTarget(origin: string, mode: string | null) {
  const loginPath =
    mode === 'employee' ? '/login?mode=employee&loggedOut=1' : '/login?loggedOut=1';
  return new URL(withAppBasePath(loginPath, 'external'), origin);
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('mode');
  const response = NextResponse.redirect(resolveLoginTarget(request.nextUrl.origin, mode));
  clearSessionCookie(response);
  return response;
}

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
