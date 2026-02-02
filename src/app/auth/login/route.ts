import { NextRequest, NextResponse } from 'next/server';

import { hashPassword, needsRehash, verifyPassword } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';
import { withAppBasePath } from '@/lib/routes';
import { SESSION_COOKIE, createTeamSessionToken } from '@/lib/team-session';

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

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

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const mode = String(formData.get('mode') ?? '').trim();
  const origin = request.nextUrl.origin;

  if (mode !== 'employee') {
    return NextResponse.redirect(new URL(withAppBasePath('/login', 'external'), origin));
  }

  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const redirectParam = String(formData.get('redirect') ?? '').trim() || null;

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
    },
  });

  if (!employee) {
    return buildLoginRedirect(origin, 'invalid', redirectParam);
  }

  if (employee.isActive === 0) {
    return buildLoginRedirect(origin, 'inactive', redirectParam);
  }

  const passwordMatches = verifyPassword(password, employee.password);

  if (!passwordMatches) {
    return buildLoginRedirect(origin, 'invalid', redirectParam);
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
  const cookieValue = createTeamSessionToken({
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
