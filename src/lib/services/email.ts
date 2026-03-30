import nodemailer from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: MailAttachment[];
  fromName?: string;
}

export interface MailDeliveryResult {
  messageId: string | null;
  accepted: string[];
  rejected: string[];
  response: string | null;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from?: string;
  starttls: boolean;
  secure: boolean;
  dkim: SmtpDkimConfig | null;
}

export interface SmtpDkimConfig {
  domainName: string;
  keySelector: string;
  privateKey: string;
}

export function loadSmtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST?.trim() ?? '';
  const port = Number.parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER?.trim() || undefined;
  const pass = process.env.SMTP_PASS?.trim() || undefined;
  const from = process.env.SMTP_FROM?.trim() || user;
  const starttls = (process.env.SMTP_STARTTLS ?? '1') !== '0';
  const secure = (process.env.SMTP_SSL ?? '0') === '1' || port === 465;
  const dkim = resolveDkimConfig();

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    user,
    pass,
    from,
    starttls,
    secure,
    dkim,
  };
}

function parseConfiguredFrom(rawValue: string | undefined): { address: string; name?: string } | null {
  const normalized = rawValue?.trim();
  if (!normalized) return null;
  const angled = normalized.match(/^(.*)<([^<>]+)>$/);
  if (angled) {
    const name = angled[1].trim().replace(/^"|"$/g, '');
    return {
      address: angled[2].trim(),
      name: name || undefined,
    };
  }
  return { address: normalized };
}

export async function sendMailWithResult(options: SendMailOptions): Promise<MailDeliveryResult> {
  const config = loadSmtpConfig();

  if (!config.host) {
    throw new Error('SMTP_HOST ist nicht gesetzt. Hinterlege die Zugangsdaten in der .env.local beziehungsweise den Secrets.');
  }

  if (!options.to) {
    throw new Error('Empf\u00e4ngeradresse fehlt.');
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.starttls && !config.secure,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    ...(config.dkim ? { dkim: config.dkim } : {}),
  });

  const configuredFrom = parseConfiguredFrom(config.from);
  const fromAddress = configuredFrom?.address || config.user || 'noreply@example.com';
  const normalizedFromName = options.fromName?.trim() || configuredFrom?.name;
  const fromHeader =
    normalizedFromName && fromAddress
      ? `"${normalizedFromName.replace(/["\r\n]/g, '').slice(0, 120)}" <${fromAddress}>`
      : fromAddress;
  const messageIdDomain = fromAddress.includes('@')
    ? fromAddress.split('@')[1]?.trim().toLowerCase()
    : null;
  const messageId = `<${Date.now().toString(36)}.${Math.random()
    .toString(36)
    .slice(2, 12)}@${messageIdDomain || 'timevex.com'}>`;
  const headers: Record<string, string> = {
    'Auto-Submitted': 'auto-generated',
    'X-Auto-Response-Suppress': 'All',
    ...(options.headers ?? {}),
  };

  const info = await transporter.sendMail({
    to: options.to,
    from: fromHeader,
    messageId,
    envelope: {
      from: fromAddress,
      to: [options.to],
    },
    subject: options.subject,
    text: options.text,
    html: options.html,
    headers,
    attachments: options.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
    })),
  });

  console.info('[mail] sent', {
    to: options.to,
    subject: options.subject,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
  });

  return {
    messageId: info.messageId ?? null,
    accepted: Array.isArray(info.accepted)
      ? info.accepted.map((value: unknown) => String(value))
      : [],
    rejected: Array.isArray(info.rejected)
      ? info.rejected.map((value: unknown) => String(value))
      : [],
    response: typeof info.response === 'string' ? info.response : null,
  };
}

export async function sendMail(options: SendMailOptions): Promise<void> {
  await sendMailWithResult(options);
}

export async function sendTextMail(
  to: string,
  subject: string,
  body: string,
  options?: { fromName?: string }
): Promise<void> {
  await sendMail({ to, subject, text: body, fromName: options?.fromName });
}

export async function sendTextMailWithResult(
  to: string,
  subject: string,
  body: string,
  options?: { fromName?: string }
): Promise<MailDeliveryResult> {
  return sendMailWithResult({ to, subject, text: body, fromName: options?.fromName });
}

function resolveDkimConfig(): SmtpDkimConfig | null {
  const domainName = process.env.DKIM_DOMAIN?.trim() || '';
  const keySelector = process.env.DKIM_SELECTOR?.trim() || '';
  const privateKeyB64 = process.env.DKIM_PRIVATE_KEY_B64?.trim() || '';

  if (!domainName || !keySelector || !privateKeyB64) {
    return null;
  }

  try {
    const privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf8').trim();
    if (!privateKey.includes('BEGIN PRIVATE KEY') && !privateKey.includes('BEGIN RSA PRIVATE KEY')) {
      return null;
    }
    return {
      domainName,
      keySelector,
      privateKey,
    };
  } catch {
    return null;
  }
}
