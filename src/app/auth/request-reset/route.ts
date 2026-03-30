import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

import { getPrisma } from '@/lib/prisma';
import { withAppBasePath } from '@/lib/routes';
import { sendTextMail } from '@/lib/services/email';

const RESET_TTL_MS = 1000 * 60 * 30;

const isEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

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
  const emailInput = String(formData.get('email') ?? '').trim();
  const origin = getPublicOrigin(request);

  if (!emailInput) {
    const errorUrl = new URL(withAppBasePath('/forgot?mode=employee&error=missing', 'external'), origin);
    return NextResponse.redirect(errorUrl);
  }

  const prisma = getPrisma();
  const employee = await prisma.employee.findFirst({
    where: {
      OR: [
        { email: { equals: emailInput, mode: 'insensitive' } },
        { username: { equals: emailInput, mode: 'insensitive' } },
      ],
    },
    select: {
      tenantId: true,
      email: true,
      username: true,
      firstName: true,
      lastName: true,
    },
  });

  const resolvedEmail =
    employee?.email?.trim() ||
    (employee?.username && isEmail(employee.username.trim()) ? employee.username.trim() : null);

  if (employee && resolvedEmail) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    await prisma.passwordReset.deleteMany({
      where: { tenantId: employee.tenantId, email: resolvedEmail },
    });
    await prisma.passwordReset.create({
      data: {
        tenantId: employee.tenantId,
        email: resolvedEmail,
        token,
        expiresAt,
      },
    });

    const resetPath = withAppBasePath(`/reset?token=${encodeURIComponent(token)}`, 'external');
    const resetUrl = new URL(resetPath, origin).toString();
    const name = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.replace(/\s+/g, ' ').trim();
    const greeting = name ? `Hallo ${name},` : 'Hallo,';
    const body = [
      greeting,
      '',
      'du hast ein neues Passwort f\u00fcr dein Konto angefordert.',
      `\u00d6ffne diesen Link, um dein Passwort zu setzen: ${resetUrl}`,
      '',
      'Der Link ist 30 Minuten g\u00fcltig.',
      'Wenn du die Anfrage nicht gestellt hast, kannst du diese Nachricht ignorieren.',
    ].join('\n');

    console.info('[auth] password reset mail attempt', {
      tenantId: employee.tenantId,
      to: resolvedEmail,
    });

    try {
      await sendTextMail(resolvedEmail, 'Passwort zur\u00fccksetzen', body);
      console.info('[auth] password reset mail dispatched', {
        tenantId: employee.tenantId,
        to: resolvedEmail,
      });
    } catch (error) {
      console.error('[auth] password reset mail failed', {
        tenantId: employee.tenantId,
        to: resolvedEmail,
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : error,
      });
    }
  } else {
    console.info('[auth] password reset skipped: no matching employee', {
      emailInput,
    });
  }

  const successUrl = new URL(withAppBasePath('/forgot?mode=employee&sent=1', 'external'), origin);
  return NextResponse.redirect(successUrl);
}
