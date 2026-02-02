import { NextRequest, NextResponse } from 'next/server';

import { hashPassword } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';
import { withAppBasePath } from '@/lib/routes';

const MIN_PASSWORD_LENGTH = 8;

function redirectWithError(origin: string, token: string | null, error: string) {
  const base = token ? `/reset?token=${encodeURIComponent(token)}&error=${error}` : `/forgot?error=${error}`;
  return NextResponse.redirect(new URL(withAppBasePath(base, 'external'), origin));
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const token = String(formData.get('token') ?? '').trim() || null;
  const password = String(formData.get('password') ?? '').trim();
  const confirm = String(formData.get('confirm_password') ?? '').trim();
  const origin = request.nextUrl.origin;

  if (!token) {
    return redirectWithError(origin, null, 'invalid');
  }
  if (!password || !confirm) {
    return redirectWithError(origin, token, 'missing');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return redirectWithError(origin, token, 'weak');
  }
  if (password !== confirm) {
    return redirectWithError(origin, token, 'mismatch');
  }

  const prisma = getPrisma();
  const reset = await prisma.passwordReset.findUnique({ where: { token } });
  if (!reset || reset.expiresAt.getTime() < Date.now()) {
    if (reset) {
      await prisma.passwordReset.delete({ where: { token } });
    }
    return redirectWithError(origin, token, 'invalid');
  }

  const employee = await prisma.employee.findFirst({
    where: {
      tenantId: reset.tenantId,
      OR: [
        { email: { equals: reset.email, mode: 'insensitive' } },
        { username: { equals: reset.email, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });

  if (!employee) {
    await prisma.passwordReset.delete({ where: { token } });
    return redirectWithError(origin, token, 'invalid');
  }

  await prisma.employee.update({
    where: { id: employee.id },
    data: { password: hashPassword(password) },
  });
  await prisma.passwordReset.delete({ where: { token } });

  const successUrl = new URL(withAppBasePath('/login?mode=employee&reset=1', 'external'), origin);
  return NextResponse.redirect(successUrl);
}
