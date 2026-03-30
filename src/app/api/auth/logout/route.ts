import { NextRequest, NextResponse } from 'next/server';

import { withAppBasePath } from '@/lib/routes';
import { SESSION_COOKIE } from '@/lib/team-session';

function normalizeCookieDomains(raw: string | null | undefined): Array<string | undefined> {
  const value = (raw ?? '').trim();
  const domains = new Set<string | undefined>([undefined]);
  if (!value) {
    return Array.from(domains);
  }
  domains.add(value);
  // Some environments historically set cookies with/without a leading dot. Clear both variants.
  if (value.startsWith('.')) {
    domains.add(value.slice(1));
  } else {
    domains.add(`.${value}`);
  }
  return Array.from(domains);
}

function appendClearCookieHeader(response: NextResponse, opts: { name: string; domain?: string; path: string; httpOnly?: boolean }) {
  const secure = process.env.NODE_ENV === 'production';
  const parts: string[] = [];
  parts.push(`${opts.name}=`);
  parts.push(`Path=${opts.path}`);
  parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  parts.push('Max-Age=0');
  if (opts.domain) {
    parts.push(`Domain=${opts.domain}`);
  }
  if (secure) {
    parts.push('Secure');
  }
  if (opts.httpOnly !== false) {
    parts.push('HttpOnly');
  }
  parts.push('SameSite=Lax');
  response.headers.append('Set-Cookie', parts.join('; '));
}

function clearCookieVariants(response: NextResponse, name: string, httpOnly = true) {
  const cookieDomains = normalizeCookieDomains(process.env.TEAM_SESSION_COOKIE_DOMAIN);
  const paths = ['/', '/admin', '/mitarbeiter'];
  const basePath = (process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '').trim();
  if (basePath && basePath.startsWith('/')) {
    paths.push(basePath);
  }
  for (const domain of cookieDomains) {
    for (const path of paths) {
      appendClearCookieHeader(response, { name, domain, path, httpOnly });
    }
  }
}

function clearSessionCookie(response: NextResponse) {
  clearCookieVariants(response, SESSION_COOKIE, true);
  // Also clear redirect-loop protection cookie, otherwise the user may get stuck after logout/login hops.
  clearCookieVariants(response, 'redirect_count', false);
}

function resolveLoginTarget(origin: string, mode: string | null) {
  const loginPath = mode === 'employee' ? '/login?mode=employee' : '/login?mode=employee';
  return new URL(withAppBasePath(loginPath, 'external'), origin);
}

function getPublicOrigin(request: NextRequest) {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  // Prefer the directly received host for logout redirects.
  // Some proxy hops may carry a stale x-forwarded-host (e.g. app domain),
  // which would otherwise bounce users to the wrong login origin.
  const host = request.headers.get('host') ?? request.headers.get('x-forwarded-host');
  if (host) {
    return `${proto}://${host}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('mode');
  const origin = getPublicOrigin(request);
  const response = NextResponse.redirect(resolveLoginTarget(origin, mode));
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');
  clearSessionCookie(response);
  return response;
}

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.headers.set('Cache-Control', 'no-store');
  clearSessionCookie(response);
  return response;
}
