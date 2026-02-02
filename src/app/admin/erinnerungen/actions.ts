import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  formatNextScheduled,
  sanitizeReminderSettings,
  sendReminderTestMail,
} from '@/lib/services/reminder';
import { saveReminderSettings } from '@/lib/data/reminders';

import type { ReminderFormState, ReminderTestState } from './types';

export function ensureAdmin(session: Awaited<ReturnType<typeof getServerAuthSession>>) {
  if (!session?.user) {
    redirect(withAppBasePath('/login'));
  }
  if (session.user.roleId !== 2) {
    redirect(withAppBasePath('/mitarbeiter'));
  }
}

export async function saveReminderAction(
  prevState: ReminderFormState,
  formData: FormData
): Promise<ReminderFormState> {
  'use server';

  const session = await getServerAuthSession();
  ensureAdmin(session);

  const enabled = formData.get('enabled') === 'on';
  const sendHour = Number.parseInt(String(formData.get('sendHour') ?? '0'), 10);
  const subject = String(formData.get('subject') ?? '').trim();
  const contentTemplate = String(formData.get('contentTemplate') ?? '');

  const { settings, unknownKeys } = sanitizeReminderSettings({
    enabled,
    sendHour,
    subject,
    contentTemplate,
  });

  if (unknownKeys.length) {
    return {
      status: 'error',
      message: `Unbekannte Platzhalter: ${unknownKeys.map((k) => `{${k}}`).join(', ')}`,
      unknownKeys,
      settings,
    };
  }

  saveReminderSettings(settings);
  const nextRun = formatNextScheduled(settings.sendHour);

  return {
    status: 'success',
    message: 'Einstellungen gespeichert.',
    settings,
    nextRun,
  };
}

export async function sendTestReminderAction(formData: FormData): Promise<ReminderTestState> {
  'use server';

  const session = await getServerAuthSession();
  ensureAdmin(session);

  const email = String(formData.get('testEmail') ?? '').trim();
  if (!email) {
    return {
      status: 'error',
      message: 'Bitte Empfängeradresse angeben.',
    };
  }

  const enabled = formData.get('enabled') === 'on';
  const sendHour = Number.parseInt(String(formData.get('sendHour') ?? '0'), 10);
  const subject = String(formData.get('subject') ?? '').trim();
  const contentTemplate = String(formData.get('contentTemplate') ?? '');
  const previewName = String(formData.get('previewName') ?? '').trim() || 'Alex';

  const { settings, unknownKeys } = sanitizeReminderSettings({
    enabled,
    sendHour,
    subject,
    contentTemplate,
  });

  if (unknownKeys.length) {
    return {
      status: 'error',
      message: `Unbekannte Platzhalter: ${unknownKeys.map((k) => `{${k}}`).join(', ')}`,
    };
  }

  try {
    await sendReminderTestMail({
      to: email,
      settings,
      previewName,
    });
    return {
      status: 'success',
      message: 'Testmail gesendet.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Versand fehlgeschlagen.';
    return {
      status: 'error',
      message,
    };
  }
}
