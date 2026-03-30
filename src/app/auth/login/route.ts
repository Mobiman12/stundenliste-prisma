import { NextRequest, NextResponse } from 'next/server';

import { hashPassword, needsRehash, verifyPassword } from '@/lib/auth';
import { pushStaffLifecycleUpdateToControlPlane } from '@/lib/control-plane';
import { toLocalIsoDate } from '@/lib/date/local-iso';
import { getPrisma } from '@/lib/prisma';
import { withAppBasePath } from '@/lib/routes';
import { SESSION_COOKIE, createTeamSessionToken } from '@/lib/team-session';

const SESSION_TTL_MS = 1000 * 60 * 15;

function extractClientIp(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get('x-real-ip')?.trim();
  return realIp || null;
}

async function callIpGuard(
  event: 'check' | 'failure' | 'success',
  {
    ip,
    app,
    path,
    userAgent,
  }: { ip: string; app?: string; path?: string; userAgent?: string | null },
): Promise<
  | {
      ok: true;
      locked?: boolean;
      permanent?: boolean;
      retryAfterSeconds?: number | null;
      hint?: string | null;
      remainingAttempts?: number | null;
      nextLockHint?: 'lock_10m' | 'lock_24h' | null;
      stage?: number | null;
      failedCount?: number | null;
    }
  | null
> {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  if (!baseUrl) return null;
  const secret = process.env.PROVISION_SECRET?.trim();
  try {
    const response = await fetch(`${baseUrl}/api/internal/auth/ip-guard`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { 'x-provision-secret': secret } : {}),
      },
      body: JSON.stringify({ event, ip, app, path, userAgent }),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json().catch(() => null);
    if (!payload || typeof payload !== 'object') return null;
    const data = payload as Record<string, unknown>;
    if (data.ok !== true) return null;
    return {
      ok: true,
      locked: data.locked === true,
      permanent: data.permanent === true,
      retryAfterSeconds: typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : null,
      hint: typeof data.hint === 'string' ? data.hint : null,
      remainingAttempts: typeof data.remainingAttempts === 'number' ? data.remainingAttempts : null,
      nextLockHint:
        data.nextLockHint === 'lock_10m' || data.nextLockHint === 'lock_24h'
          ? data.nextLockHint
          : null,
      stage: typeof data.stage === 'number' ? data.stage : null,
      failedCount: typeof data.failedCount === 'number' ? data.failedCount : null,
    };
  } catch {
    return null;
  }
}

async function fetchTenantInfo(tenantId: string): Promise<{ name?: string | null; slug?: string | null } | null> {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  if (!baseUrl) return null;

  try {
    const url = new URL('/api/internal/tenant/info', baseUrl);
    url.searchParams.set('tenantId', tenantId);
    const secret = process.env.PROVISION_SECRET?.trim();
    const response = await fetch(url.toString(), {
      headers: secret ? { 'x-provision-secret': secret } : undefined,
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { tenantName?: string | null; tenantSlug?: string | null };
    return { name: data.tenantName ?? null, slug: data.tenantSlug ?? null };
  } catch {
    return null;
  }
}

function normalizeRedirect(raw: string | null, fallback: string, origin: string): string {
  if (!raw) return fallback;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}` || fallback;
  } catch {
    return fallback;
  }
}

function buildLoginRedirect(origin: string, errorCode: string, redirectParam: string | null): NextResponse {
  const loginUrl = new URL(withAppBasePath('/login', 'external'), origin);
  loginUrl.searchParams.set('mode', 'employee');
  loginUrl.searchParams.set('error', errorCode);
  if (redirectParam) {
    loginUrl.searchParams.set('redirect', redirectParam);
  }
  return NextResponse.redirect(loginUrl);
}

function buildLoginRedirectWithHint(
  origin: string,
  errorCode: string,
  redirectParam: string | null,
  hint?: string | null,
  retryAfterSeconds?: number | null,
  remainingAttempts?: number | null,
): NextResponse {
  const loginUrl = new URL(withAppBasePath('/login', 'external'), origin);
  loginUrl.searchParams.set('mode', 'employee');
  loginUrl.searchParams.set('error', errorCode);
  if (redirectParam) {
    loginUrl.searchParams.set('redirect', redirectParam);
  }
  if (hint) {
    loginUrl.searchParams.set('hint', hint);
  }
  if (typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0) {
    loginUrl.searchParams.set('retry', String(Math.min(999999, Math.floor(retryAfterSeconds))));
  }
  if (typeof remainingAttempts === 'number' && remainingAttempts >= 0) {
    loginUrl.searchParams.set('remaining', String(Math.floor(remainingAttempts)));
  }
  return NextResponse.redirect(loginUrl);
}

function getPublicOrigin(request: NextRequest) {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) {
    return `${proto}://${host}`;
  }
  return request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const mode = String(formData.get('mode') ?? '').trim();
  const origin = getPublicOrigin(request);

  if (mode !== 'employee') {
    return NextResponse.redirect(new URL(withAppBasePath('/login', 'external'), origin));
  }

  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const redirectParam = String(formData.get('redirect') ?? '').trim() || null;

  const ip = extractClientIp(request.headers);
  const userAgent = request.headers.get('user-agent');
  if (ip) {
    const status = await callIpGuard('check', { ip, app: 'TIMESHIFT', path: '/login', userAgent });
    if (status?.locked) {
      return buildLoginRedirectWithHint(origin, 'locked', redirectParam, 'locked', status.retryAfterSeconds ?? null);
    }
  }

  if (!username || !password) {
    return buildLoginRedirect(origin, 'missing', redirectParam);
  }

  const prisma = getPrisma();
  const employee = await prisma.employee.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: {
      id: true,
      username: true,
      password: true,
      tenantId: true,
      email: true,
      isActive: true,
      exitDate: true,
      controlPlaneStaffId: true,
    },
  });

  if (!employee) {
    if (ip) {
      const status = await callIpGuard('failure', { ip, app: 'TIMESHIFT', path: '/login', userAgent });
      if (status?.locked) {
        return buildLoginRedirectWithHint(origin, 'locked', redirectParam, 'locked', status.retryAfterSeconds ?? null);
      }
      return buildLoginRedirectWithHint(
        origin,
        'invalid',
        redirectParam,
        status?.hint ?? null,
        null,
        status?.remainingAttempts ?? null,
      );
    }
    return buildLoginRedirect(origin, 'invalid', redirectParam);
  }

  const todayIso = toLocalIsoDate();
  const exitDateReached = Boolean(employee.exitDate && employee.exitDate < todayIso);
  if (exitDateReached && employee.isActive !== 0) {
    await prisma.employee.update({
      where: { id: employee.id },
      data: { isActive: 0, showInCalendar: 0 },
    });
    if (employee.controlPlaneStaffId) {
      await pushStaffLifecycleUpdateToControlPlane({
        tenantId: employee.tenantId,
        staffId: employee.controlPlaneStaffId,
        action: 'deactivate',
        reason: 'exit_date_passed',
      });
    }
  }

  if (employee.isActive === 0 || exitDateReached) {
    return buildLoginRedirect(origin, 'inactive', redirectParam);
  }

  const passwordMatches = verifyPassword(password, employee.password);

  if (!passwordMatches) {
    if (ip) {
      const status = await callIpGuard('failure', { ip, app: 'TIMESHIFT', path: '/login', userAgent });
      if (status?.locked) {
        return buildLoginRedirectWithHint(origin, 'locked', redirectParam, 'locked', status.retryAfterSeconds ?? null);
      }
      return buildLoginRedirectWithHint(
        origin,
        'invalid',
        redirectParam,
        status?.hint ?? null,
        null,
        status?.remainingAttempts ?? null,
      );
    }
    return buildLoginRedirect(origin, 'invalid', redirectParam);
  }

  if (ip) {
    await callIpGuard('success', { ip, app: 'TIMESHIFT', path: '/login', userAgent });
  }

  if (needsRehash(employee.password)) {
    const nextHash = hashPassword(password);
    await prisma.employee.update({
      where: { id: employee.id },
      data: { password: nextHash },
    });
  }

  const tenantInfo = employee.tenantId ? await fetchTenantInfo(employee.tenantId) : null;
  const expiresMs = Date.now() + SESSION_TTL_MS;
  const cookieValue = await createTeamSessionToken({
    username: employee.username,
    expiresAt: expiresMs,
    tenantId: employee.tenantId,
    tenantName: tenantInfo?.name ?? null,
    tenantSlug: tenantInfo?.slug ?? null,
    email: employee.email ?? null,
    app: 'TIMESHIFT',
  });

  const redirectPath = normalizeRedirect(redirectParam, '/mitarbeiter', origin);
  const response = NextResponse.redirect(new URL(withAppBasePath(redirectPath, 'external'), origin));
  const cookieDomain = process.env.TEAM_SESSION_COOKIE_DOMAIN?.trim() || undefined;
  response.cookies.set({
    name: SESSION_COOKIE,
    value: cookieValue,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresMs),
    secure: process.env.NODE_ENV === 'production',
    domain: cookieDomain,
  });

  return response;
}
