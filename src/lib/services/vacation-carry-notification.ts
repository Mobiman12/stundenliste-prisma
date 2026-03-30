import { getEmployeeById } from '@/lib/data/employees';
import {
  createVacationCarryNotificationAttempt,
  updateVacationCarryNotificationResult,
} from '@/lib/data/vacation-carry-notifications';
import { sendTextMailWithResult } from '@/lib/services/email';
import { resolveCarryExpiryIsoForYear } from '@/lib/services/vacation-balance';
import { toLocalIsoDate } from '@/lib/date/local-iso';

const TENANT_MAIL_CONTEXT_CACHE = new Map<string, string>();

function formatIsoDateForMail(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

async function getTenantMailDisplayName(tenantId: string): Promise<string> {
  const cached = TENANT_MAIL_CONTEXT_CACHE.get(tenantId);
  if (cached) return cached;

  const fallback = process.env.TENANT_NAME?.trim() || 'Timevex';
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  if (!baseUrl) {
    TENANT_MAIL_CONTEXT_CACHE.set(tenantId, fallback);
    return fallback;
  }

  try {
    const url = new URL('/api/internal/tenant/info', baseUrl);
    url.searchParams.set('tenantId', tenantId);
    const secret = process.env.PROVISION_SECRET?.trim();
    const response = await fetch(url.toString(), {
      headers: secret ? { 'x-provision-secret': secret } : undefined,
      cache: 'no-store',
    });
    if (!response.ok) {
      TENANT_MAIL_CONTEXT_CACHE.set(tenantId, fallback);
      return fallback;
    }
    const payload = (await response.json().catch(() => null)) as { tenantName?: string | null } | null;
    const tenantName = payload?.tenantName?.trim() || fallback;
    TENANT_MAIL_CONTEXT_CACHE.set(tenantId, tenantName);
    return tenantName;
  } catch {
    TENANT_MAIL_CONTEXT_CACHE.set(tenantId, fallback);
    return fallback;
  }
}

export async function sendVacationCarryExpiryNotification(input: {
  tenantId: string;
  employeeId: number;
  year: number;
  carryDays: number;
  expiryDate: string;
}): Promise<void> {
  const notifyMode = (process.env.VACATION_CARRY_NOTIFY_MODE ?? 'off').trim().toLowerCase();
  if (notifyMode !== 'live' && notifyMode !== 'test') {
    return;
  }

  const now = new Date();
  if (input.year !== now.getFullYear()) {
    return;
  }
  if (!(input.carryDays > 0)) {
    return;
  }
  const expiryIso = resolveCarryExpiryIsoForYear(input.year, input.expiryDate);
  if (!expiryIso) return;
  const todayIso = toLocalIsoDate(now);
  if (expiryIso < todayIso) {
    return;
  }

  const employee = await getEmployeeById(input.tenantId, input.employeeId);
  const recipient = notifyMode === 'test'
    ? 'support@timevex.com'
    : employee?.email?.trim();
  if (!employee || !recipient) {
    return;
  }

  const companyName = await getTenantMailDisplayName(input.tenantId);
  const employeeName = `${employee.first_name} ${employee.last_name}`.trim() || 'Mitarbeiter';
  const formattedCarry = input.carryDays.toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const expiryLabel = formatIsoDateForMail(expiryIso);
  const subject = `${companyName}: Hinweis zu deinem Resturlaub ${input.year}`;
  const body = [
    `Hallo ${employeeName},`,
    '',
    `es wurden ${formattedCarry} Resturlaubstage in das Jahr ${input.year} übernommen.`,
    `Bitte plane diesen Resturlaub jetzt aktiv ein und reiche ihn rechtzeitig ein.`,
    `Wichtiger Hinweis: Ohne Inanspruchnahme verfällt dieser Resturlaub am ${expiryLabel}.`,
    `Diese Mitteilung erfolgt in Textform (§ 126b BGB).`,
    '',
    'Viele Grüße',
    companyName,
  ].join('\n');

  const attempt = await createVacationCarryNotificationAttempt({
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    year: input.year,
    recipient,
    fromName: companyName,
    subject,
    bodyText: body,
  });
  if (!attempt) {
    return;
  }

  try {
    const result = await sendTextMailWithResult(recipient, subject, body, { fromName: companyName });
    const accepted = result.accepted.map((value) => value.toLowerCase());
    const isAccepted = accepted.some((value) => value.includes(recipient.toLowerCase()));
    await updateVacationCarryNotificationResult(attempt.id, {
      status: isAccepted ? 'smtp_accepted' : 'failed',
      providerMessageId: result.messageId,
      providerResponse: result.response,
      errorMessage: isAccepted
        ? null
        : result.rejected.length
          ? `Empfänger abgelehnt: ${result.rejected.join(', ')}`
          : 'SMTP-Annahme nicht bestätigt.',
      sentAt: new Date(),
    });
  } catch (error) {
    await updateVacationCarryNotificationResult(attempt.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unbekannter Versandfehler',
      sentAt: new Date(),
    });
  }
}
