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
  attachments?: MailAttachment[];
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from?: string;
  starttls: boolean;
  secure: boolean;
}

export function loadSmtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST?.trim() ?? '';
  const port = Number.parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER?.trim() || undefined;
  const pass = process.env.SMTP_PASS?.trim() || undefined;
  const from = process.env.SMTP_FROM?.trim() || user;
  const starttls = (process.env.SMTP_STARTTLS ?? '1') !== '0';
  const secure = (process.env.SMTP_SSL ?? '0') === '1' || port === 465;

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    user,
    pass,
    from,
    starttls,
    secure,
  };
}

export async function sendMail(options: SendMailOptions): Promise<void> {
  const config = loadSmtpConfig();

  if (!config.host) {
    throw new Error('SMTP_HOST ist nicht gesetzt. Hinterlege die Zugangsdaten in der .env.local beziehungsweise den Secrets.');
  }

  if (!options.to) {
    throw new Error('Empfängeradresse fehlt.');
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.starttls && !config.secure,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
  });

  await transporter.sendMail({
    to: options.to,
    from: config.from || config.user || 'noreply@example.com',
    subject: options.subject,
    text: options.text,
    attachments: options.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
    })),
  });
}

export async function sendTextMail(to: string, subject: string, body: string): Promise<void> {
  await sendMail({ to, subject, text: body });
}
