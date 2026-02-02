import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { findUserProfileByUsername, hashPassword } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';
import { withAppBasePath } from '@/lib/routes';
import { verifyTenantSsoToken } from '@/lib/sso';
import { SESSION_COOKIE, createTeamSessionToken } from '@/lib/team-session';

const ENABLE_TENANT_SSO_AUTOPROVISION =
  process.env.ENABLE_TENANT_SSO_AUTOPROVISION?.trim() !== 'false';

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

async function ensureAdminUser(tenantId: string, username: string) {
  const prisma = getPrisma();
  const normalizedUsername = username.trim() || 'Admin';
  const existing = await prisma.admin.findFirst({
    where: {
      tenantId,
      username: { equals: normalizedUsername, mode: 'insensitive' },
    },
    select: { id: true, username: true },
  });
  if (existing) {
    return existing;
  }

  const tempPassword = randomBytes(16).toString('hex');
  const created = await prisma.admin.create({
    data: {
      tenantId,
      username: normalizedUsername,
      password: hashPassword(tempPassword),
    },
    select: { id: true, username: true },
  });
  return created;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');
  const payload = verifyTenantSsoToken(token, 'TIMESHIFT');
  const origin = request.nextUrl.origin;

  if (!payload) {
    const loginUrl = new URL(withAppBasePath('/login', 'external'), origin);
    return NextResponse.redirect(loginUrl);
  }

  const username = (payload.username ?? 'Admin').toString().trim() || 'Admin';
  const tenantId = payload.tenantId;
  let profile = await findUserProfileByUsername(username, tenantId);
  if (!profile && username.toLowerCase() === 'admin') {
    profile = await findUserProfileByUsername('demo', tenantId);
  }
  if (!profile && ENABLE_TENANT_SSO_AUTOPROVISION) {
    const admin = await ensureAdminUser(tenantId, username);
    profile = {
      id: admin.id,
      username: admin.username,
      roleId: 2,
      accountType: 'admin',
      email: null,
      firstName: null,
      lastName: null,
      employeeId: null,
    };
  }

  if (!profile) {
    const loginUrl = new URL(withAppBasePath('/login', 'external'), origin);
    return NextResponse.redirect(loginUrl);
  }

  const expiresMs = Number(payload.exp);
  const cookieValue = createTeamSessionToken({
    username: profile.username,
    expiresAt: expiresMs,
    tenantId: payload.tenantId,
    tenantSlug: payload.tenantSlug,
    tenantName: payload.tenantName,
    email: payload.email,
    app: payload.app,
  });

  const fallbackRedirect = payload.returnTo ?? '/admin';
  const redirectParam = searchParams.get('redirect');
  const redirectPath = normalizeRedirect(redirectParam, fallbackRedirect, origin);
  const redirectTarget = new URL(withAppBasePath(redirectPath, 'external'), origin);

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
