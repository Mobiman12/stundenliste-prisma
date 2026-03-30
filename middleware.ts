import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE, verifyTeamSession } from '@/lib/team-session';

const INTEGRATION_API_KEY = process.env.INTEGRATION_API_KEY?.trim() ?? '';
const PROVISION_SECRET = process.env.PROVISION_SECRET?.trim() ?? '';
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:3003';
const CONTROL_PLANE_PUBLIC_URL = process.env.CONTROL_PLANE_PUBLIC_URL ?? CONTROL_PLANE_URL;
const TIMESHIFT_PUBLIC_HOST = process.env.TIMESHIFT_PUBLIC_HOST?.trim().toLowerCase();
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

function applyNoStoreHeaders(response: NextResponse) {
  // Prevent browsers from caching authenticated pages. This ensures "Back" after logout
  // will not show stale dashboard content from the browser cache.
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');
  response.headers.append('Vary', 'Cookie');
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

function hasProvisionAuthorization(request: NextRequest): boolean {
  if (!PROVISION_SECRET) return false;
  const incoming = request.headers.get('x-provision-secret');
  return Boolean(incoming && incoming === PROVISION_SECRET);
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isRscRequest(request: NextRequest): boolean {
  const rscHeader = request.headers.get('rsc');
  if (rscHeader && rscHeader !== '0') return true;
  if (request.headers.has('next-action')) return true;
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/x-component');
}

function parseHost(host: string | null) {
  if (!host) return null;
  const normalized = host.split(':')[0].toLowerCase();
  if (TIMESHIFT_PUBLIC_HOST && normalized === TIMESHIFT_PUBLIC_HOST) return null;
  const parts = normalized.split('.');
  if (parts.length < 3) return null;
  const [tenantSlug, appKey] = parts;
  // Domain/product name has been renamed to "timesheet", but we keep accepting legacy "timeshift".
  if (appKey !== 'timesheet' && appKey !== 'timeshift') return null;
  return { tenantSlug, appKey };
}

function buildCanonicalHost(currentHost: string, canonicalTenantSlug: string): string | null {
  const normalized = (currentHost || '').split(':')[0].toLowerCase();
  const parts = normalized.split('.');
  if (parts.length < 3) return null;
  // Replace only the left-most label (tenant slug), keep the rest unchanged.
  parts[0] = canonicalTenantSlug.toLowerCase();
  return parts.join('.');
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
  const provisionAuthorized = hasProvisionAuthorization(request);
  const acceptsHtml = (request.headers.get('accept') ?? '').includes('text/html');

  // Internal endpoints are protected via x-provision-secret and must never trigger tenant-guard or browser SSO redirects.
  // This is required for Control-Plane -> Timesheet sync calls (shift-plan, staff sync, etc.). (Legacy internal key: "timeshift")
  const internalPathPrefix = APP_BASE_PATH ? `${APP_BASE_PATH}/api/internal` : null;
  const isInternalPath =
    normalizedPathname === '/api/internal' ||
    normalizedPathname.startsWith('/api/internal/') ||
    (internalPathPrefix
      ? normalizedPathname === internalPathPrefix || normalizedPathname.startsWith(`${internalPathPrefix}/`)
      : false);
  if (isInternalPath && provisionAuthorized) {
    return nextWithReset(requestHeaders);
  }

  const requestHost = (request.headers.get('host') || '').split(':')[0].toLowerCase();
  if (TIMESHIFT_PUBLIC_HOST && requestHost == TIMESHIFT_PUBLIC_HOST && normalizedPathname == '/') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.search = 'mode=employee';
    return redirectWithCount(request, redirectUrl);
  }

  if (ENABLE_TENANT_GUARD) {
    const parsed = parseHost(request.headers.get('host'));
    if (parsed) {
      if (normalizedPathname.endsWith('/trial-expired') || normalizedPathname === '/trial-expired') {
        return nextWithReset(requestHeaders);
      }
      const match = await resolveTenant(parsed.tenantSlug, parsed.appKey);
      if (!match) {
        // If the user already has a valid session (cookie domain can be shared across subdomains),
        // redirect them to their canonical tenant subdomain instead of hard-blocking.
        const cookieValue = request.cookies.get(SESSION_COOKIE)?.value ?? null;
        const session = await verifyTeamSession(cookieValue);
        const canonicalSlug = session?.tenantSlug?.trim();
        const currentHost = request.headers.get('host') || '';
        if (canonicalSlug) {
          const canonicalHost = buildCanonicalHost(currentHost, canonicalSlug);
          if (canonicalHost && canonicalHost !== currentHost.split(':')[0].toLowerCase()) {
            const redirectUrl = request.nextUrl.clone();
            redirectUrl.hostname = canonicalHost;
            redirectUrl.port = '';
            return redirectWithCount(request, redirectUrl);
          }
        }

        const response = NextResponse.json({ message: 'Tenant/App nicht freigeschaltet' }, { status: 403 });
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

  const shouldNoStore =
    acceptsHtml &&
    !isApiPath(relativePathname) &&
    // Public/auth screens are fine to be no-store as well, but we mainly care about authenticated pages.
    (relativePathname.startsWith('/admin') ||
      relativePathname.startsWith('/mitarbeiter') ||
      relativePathname === '/dashboard');

  // Internal endpoints are protected via x-provision-secret and must not trigger browser SSO redirects.
  if (relativePathname === '/api/internal' || relativePathname.startsWith('/api/internal/')) {
    if (provisionAuthorized) {
      return nextWithReset(requestHeaders);
    }
  }

  const publicPaths = new Set([
    '/login',
    '/forgot',
    '/reset',
    '/auth/login',
    '/auth/request-reset',
    '/auth/reset',
    '/api/auth/logout',
    '/api/postal-lookup',
    '/api/onboarding/submit',
    '/trial-expired',
    '/api/health',
  ]);
  // Static branding assets must be publicly reachable (login page, favicon, etc.).
  // Otherwise the browser will show the <img alt="Timevex"> fallback when the logo is blocked by SSO redirects.
  if (relativePathname === '/branding' || relativePathname.startsWith('/branding/')) {
    const res = nextWithReset(requestHeaders);
    if (shouldNoStore) applyNoStoreHeaders(res);
    return res;
  }
  if (relativePathname === '/bewerbung' || relativePathname.startsWith('/bewerbung/')) {
    const res = nextWithReset(requestHeaders);
    if (shouldNoStore) applyNoStoreHeaders(res);
    return res;
  }
  if (publicPaths.has(relativePathname)) {
    // If a user is already logged in and visits a different tenant's subdomain, redirect them to their canonical host.
    const cookieValue = request.cookies.get(SESSION_COOKIE)?.value ?? null;
    const session = await verifyTeamSession(cookieValue);
    const canonicalSlug = session?.tenantSlug?.trim();
    const parsedHost = parseHost(request.headers.get('host'));
    if (canonicalSlug && parsedHost && parsedHost.tenantSlug !== canonicalSlug.toLowerCase()) {
      const currentHost = request.headers.get('host') || '';
      const canonicalHost = buildCanonicalHost(currentHost, canonicalSlug);
      if (canonicalHost) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.hostname = canonicalHost;
        redirectUrl.port = '';
        return redirectWithCount(request, redirectUrl);
      }
    }

    const res = nextWithReset(requestHeaders);
    if (shouldNoStore) applyNoStoreHeaders(res);
    return res;
  }

  if (isApiPath(relativePathname) && hasIntegrationAuthorization(request)) {
    return nextWithReset(requestHeaders);
  }

  const cookieValue = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  const session = await verifyTeamSession(cookieValue);
  const hasTenantContext = Boolean(session?.tenantId);
  const hasValidSession = Boolean(session && (!REQUIRE_TENANT_SESSION || hasTenantContext));

  // For authenticated requests, the tenant context must be derived from the session (not from the host).
  // Otherwise a shared cookie domain would allow cross-tenant data access by simply changing the subdomain.
  if (session?.tenantId) {
    requestHeaders.set('x-tenant-id', String(session.tenantId));
  }

  if (!hasValidSession) {
    if (relativePathname === '/') {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = APP_BASE_PATH ? `${APP_BASE_PATH}/login` : '/login';
      loginUrl.search = 'mode=employee';
      return redirectWithCount(request, loginUrl);
    }

    const rscRequest = isRscRequest(request);
    const wantsInteractiveRedirect = acceptsHtml || rscRequest;

    if (!wantsInteractiveRedirect) {
      const response = NextResponse.json(
        { message: 'Nicht autorisiert. Bitte neu anmelden.' },
        { status: 401 },
      );
      resetRedirectCount(response);
      return response;
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = APP_BASE_PATH ? `${APP_BASE_PATH}/login` : '/login';
    const employeeMode = relativePathname.startsWith('/mitarbeiter') || relativePathname === '/dashboard';
    loginUrl.searchParams.set('mode', employeeMode ? 'employee' : 'admin');
    const redirectTarget = buildRedirectTarget(request);
    if (redirectTarget && redirectTarget !== '/') {
      loginUrl.searchParams.set('redirect', redirectTarget);
    }
    console.warn('[auth] missing session -> redirect to local login', {
      method: request.method,
      host: request.headers.get('host'),
      path: request.nextUrl.pathname,
      search: request.nextUrl.search,
      rsc: request.headers.get('rsc'),
      nextAction: request.headers.get('next-action'),
      accept: request.headers.get('accept'),
      login: loginUrl.toString(),
      referer: request.headers.get('referer'),
    });
    return redirectWithCount(request, loginUrl);
  }

  // Enforce canonical subdomain for authenticated users.
  // Example: visiting https://other-tenant.timesheet.timevex.com while logged in as murmelcreation
  // will redirect to https://murmelcreation.timesheet.timevex.com.
  const parsedHost = parseHost(request.headers.get('host'));
  const canonicalSlug = session?.tenantSlug?.trim();
  if (parsedHost && canonicalSlug && parsedHost.tenantSlug !== canonicalSlug.toLowerCase()) {
    const currentHost = request.headers.get('host') || '';
    const canonicalHost = buildCanonicalHost(currentHost, canonicalSlug);
    if (canonicalHost) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.hostname = canonicalHost;
      redirectUrl.port = '';
      return redirectWithCount(request, redirectUrl);
    }
  }

  const res = nextWithReset(requestHeaders);
  if (shouldNoStore) applyNoStoreHeaders(res);
  return res;
}

export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon.ico|public|branding).*)'
  ]
};
