import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE, verifyTeamSession } from '@/lib/team-session';

const INTEGRATION_API_KEY = process.env.INTEGRATION_API_KEY?.trim() ?? '';
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:3003';
const ENABLE_TENANT_GUARD = process.env.ENABLE_TENANT_GUARD?.trim() !== 'false';
const REQUIRE_TENANT_SESSION = process.env.REQUIRE_TENANT_SESSION?.trim() !== 'false';
const REDIRECT_COUNT_HEADER = 'x-redirect-count';
const REDIRECT_COUNT_COOKIE = 'redirect_count';
const REDIRECT_COUNT_MAX = 3;
const REDIRECT_COUNT_TTL_SECONDS = 10;

function normalizeBasePath(raw: string | undefined | null): string {
  const value = (raw ?? '').trim();
  if (!value || value === '/') {
    return '';
  }
  return value.startsWith('/') ? value.replace(/\/+$/, '') : `/${value.replace(/\/+$/, '')}`;
}

const APP_BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_APP_BASE_PATH);
const IS_DEV = process.env.NODE_ENV !== 'production';

function normalizePathname(pathname: string): string {
  if (!pathname) {
    return '/';
  }
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return normalized !== '/' ? normalized.replace(/\/+$/, '') : normalized;
}

function parseRedirectCount(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getRedirectCount(request: NextRequest): number {
  const headerValue = request.headers.get(REDIRECT_COUNT_HEADER);
  if (headerValue) {
    return parseRedirectCount(headerValue);
  }
  const cookieValue = request.cookies.get(REDIRECT_COUNT_COOKIE)?.value ?? null;
  return parseRedirectCount(cookieValue);
}

function resetRedirectCount(response: NextResponse) {
  response.headers.set(REDIRECT_COUNT_HEADER, '0');
  response.cookies.set({
    name: REDIRECT_COUNT_COOKIE,
    value: '',
    path: '/',
    expires: new Date(0),
  });
}

function setRedirectCount(response: NextResponse, count: number) {
  response.headers.set(REDIRECT_COUNT_HEADER, String(count));
  response.cookies.set({
    name: REDIRECT_COUNT_COOKIE,
    value: String(count),
    path: '/',
    maxAge: REDIRECT_COUNT_TTL_SECONDS,
    sameSite: 'lax',
  });
}

function nextWithReset(requestHeaders: Headers): NextResponse {
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  resetRedirectCount(response);
  return response;
}

function redirectWithCount(request: NextRequest, target: string | URL): NextResponse {
  const currentCount = getRedirectCount(request);
  if (currentCount >= REDIRECT_COUNT_MAX) {
    const response = NextResponse.json(
      { message: 'Redirect-Schleife erkannt. Bitte erneut anmelden.' },
      { status: 429 },
    );
    resetRedirectCount(response);
    return response;
  }
  const response = NextResponse.redirect(target);
  setRedirectCount(response, currentCount + 1);
  return response;
}

function buildRedirectTarget(request: NextRequest): string {
  const path = request.nextUrl.pathname;
  const search = request.nextUrl.search;
  if (!APP_BASE_PATH) {
    return `${path}${search}`;
  }

  if (path === APP_BASE_PATH || path.startsWith(`${APP_BASE_PATH}/`)) {
    return `${path}${search}`;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${APP_BASE_PATH}${normalizedPath === '/' ? '' : normalizedPath}${search}`;
}

function hasIntegrationAuthorization(request: NextRequest): boolean {
  if (!INTEGRATION_API_KEY) {
    return false;
  }
  const headerValue = request.headers.get('authorization');
  if (!headerValue) {
    return false;
  }
  const normalized = headerValue.trim().toLowerCase();
  if (!normalized.startsWith('bearer ')) {
    return false;
  }
  const provided = headerValue.slice(7).trim();
  return provided === INTEGRATION_API_KEY;
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function parseHost(host: string | null) {
  if (!host) return null;
  const parts = host.split('.');
  if (parts.length < 3) return null;
  const [tenantSlug, appKey] = parts;
  return { tenantSlug, appKey };
}

async function resolveTenant(tenantSlug: string, appKey: string) {
  const url = `${CONTROL_PLANE_URL}/api/internal/tenant/resolve?tenant=${encodeURIComponent(
    tenantSlug,
  )}&app=${encodeURIComponent(appKey)}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 403) {
      const data = (await res.json().catch(() => ({}))) as { reason?: string; message?: string };
      if (data?.reason === 'trial_expired' || data?.message === 'Trial abgelaufen') {
        return { ok: false, reason: 'trial_expired' } as const;
      }
      return null;
    }
    if (!res.ok) return null;
    return {
      ok: true as const,
      ...(await res.json()),
    } as {
      ok: true;
      tenantId: string;
      app: string;
      tenantStatus: string;
      provisionMode?: string;
      trialEndsAt?: string | null;
      theme?: { preset?: string; mode?: string };
    };
  } catch (error) {
    console.error('tenant resolve failed', error);
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const normalizedPathname = normalizePathname(request.nextUrl.pathname);

  if (ENABLE_TENANT_GUARD) {
    const parsed = parseHost(request.headers.get('host'));
    if (parsed) {
      if (normalizedPathname.endsWith('/trial-expired') || normalizedPathname === '/trial-expired') {
        return nextWithReset(requestHeaders);
      }
      const match = await resolveTenant(parsed.tenantSlug, parsed.appKey);
      if (!match) {
        const response = NextResponse.json(
          { message: 'Tenant/App nicht freigeschaltet' },
          { status: 403 },
        );
        resetRedirectCount(response);
        return response;
      }
      if (!match.ok && match.reason === 'trial_expired') {
        const expiredPath = `${APP_BASE_PATH}/trial-expired`.replace(/\/+$/, '') || '/trial-expired';
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = expiredPath;
        redirectUrl.search = '';
        return redirectWithCount(request, redirectUrl);
      }
      if (!match.ok) {
        const response = NextResponse.json(
          { message: 'Tenant/App nicht freigeschaltet' },
          { status: 403 },
        );
        resetRedirectCount(response);
        return response;
      }
      requestHeaders.set('x-tenant-id', match.tenantId);
      requestHeaders.set('x-app-type', match.app);
      requestHeaders.set('x-tenant-status', match.tenantStatus);
      if (match.provisionMode) requestHeaders.set('x-tenant-provision-mode', match.provisionMode);
      if (match.trialEndsAt) requestHeaders.set('x-tenant-trial-ends', match.trialEndsAt);
      if (match.theme?.preset) requestHeaders.set('x-tenant-theme', match.theme.preset);
      if (match.theme?.mode) requestHeaders.set('x-tenant-theme-mode', match.theme.mode);
    }
  }
  if (IS_DEV) {
    const devSessionPaths = new Set<string>(['/api/dev-session']);
    if (APP_BASE_PATH) {
      devSessionPaths.add(`${APP_BASE_PATH}/api/dev-session`);
    }
    if (devSessionPaths.has(normalizedPathname)) {
      return nextWithReset(requestHeaders);
    }
  }

  const ssoPaths = new Set<string>(['/auth/sso']);
  if (APP_BASE_PATH) {
    ssoPaths.add(`${APP_BASE_PATH}/auth/sso`);
  }
  if (ssoPaths.has(normalizedPathname)) {
    return nextWithReset(requestHeaders);
  }

  if (APP_BASE_PATH && request.nextUrl.pathname === '/') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = APP_BASE_PATH;
    return redirectWithCount(request, redirectUrl);
  }

  const relativePathname =
    APP_BASE_PATH && normalizedPathname.startsWith(`${APP_BASE_PATH}/`)
      ? normalizedPathname.slice(APP_BASE_PATH.length) || '/'
      : normalizedPathname;

  const publicPaths = new Set([
    '/login',
    '/forgot',
    '/reset',
    '/auth/login',
    '/auth/request-reset',
    '/auth/reset',
    '/api/auth/logout',
    '/trial-expired',
  ]);
  if (publicPaths.has(relativePathname)) {
    return nextWithReset(requestHeaders);
  }

  if (isApiPath(relativePathname) && hasIntegrationAuthorization(request)) {
    return nextWithReset(requestHeaders);
  }

  const cookieValue = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  const session = await verifyTeamSession(cookieValue);
  const hasTenantContext = Boolean(session?.tenantId);
  const hasValidSession = Boolean(session && (!REQUIRE_TENANT_SESSION || hasTenantContext));

  if (session?.tenantId && !requestHeaders.has('x-tenant-id')) {
    requestHeaders.set('x-tenant-id', String(session.tenantId));
  }

  if (!hasValidSession) {
    const redirectTarget = buildRedirectTarget(request);
    const ssoUrl = new URL('/tenant/sso', CONTROL_PLANE_URL);
    ssoUrl.searchParams.set('app', 'TIMESHIFT');
    ssoUrl.searchParams.set('redirect', redirectTarget);
    return redirectWithCount(request, ssoUrl);
  }

  return nextWithReset(requestHeaders);
}

export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon.ico|public).*)'
  ]
};
