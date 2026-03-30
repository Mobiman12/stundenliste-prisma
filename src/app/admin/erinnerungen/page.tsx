import { getServerAuthSession } from '@/lib/auth/session';
import {
  ALLOWED_REMINDER_KEYS,
  formatNextScheduled,
  getReminderLogs,
  getReminderSettings,
} from '@/lib/services/reminder';

import ReminderSettingsForm from './ReminderSettingsForm';
import { ensureAdmin, saveReminderAction, sendTestReminderAction } from './actions';
import type { ReminderFormState } from './types';

const INITIAL_FORM_STATE: ReminderFormState = {};

export default async function AdminErinnerungenPage() {
  const session = await getServerAuthSession();
  ensureAdmin(session);

  const tenantId = session?.tenantId;
  if (!tenantId) {
    throw new Error('Tenant-Kontext fehlt.');
  }

  const settings = await getReminderSettings(tenantId);
  const logs = await getReminderLogs(tenantId);
  const nextRun = formatNextScheduled(settings.sendHour);
  const timeZone = process.env.REMINDER_TZ || 'Europe/Berlin';

  return (
    <ReminderSettingsForm
      initialSettings={settings}
      initialNextRun={nextRun}
      logs={logs}
      timezone={timeZone}
      allowedKeys={Array.from(ALLOWED_REMINDER_KEYS)}
      saveAction={saveReminderAction}
      saveInitialState={INITIAL_FORM_STATE}
      testAction={sendTestReminderAction}
    />
  );
}
