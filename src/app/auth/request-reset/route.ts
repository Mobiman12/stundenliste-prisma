import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

import { getPrisma } from '@/lib/prisma';
import { withAppBasePath } from '@/lib/routes';
import { sendTextMail } from '@/lib/services/email';

const RESET_TTL_MS = 1000 * 60 * 30;

const isEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const emailInput = String(formData.get('email') ?? '').trim();
  const origin = request.nextUrl.origin;

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
      'du hast ein neues Passwort für dein Konto angefordert.',
      `Öffne diesen Link, um dein Passwort zu setzen: ${resetUrl}`,
      '',
      'Der Link ist 30 Minuten gültig.',
      'Wenn du die Anfrage nicht gestellt hast, kannst du diese Nachricht ignorieren.',
    ].join('\n');

    try {
      await sendTextMail(resolvedEmail, 'Passwort zurücksetzen', body);
    } catch (error) {
      console.error('[auth] password reset mail failed', error);
    }
  }

  const successUrl = new URL(withAppBasePath('/forgot?mode=employee&sent=1', 'external'), origin);
  return NextResponse.redirect(successUrl);
}
