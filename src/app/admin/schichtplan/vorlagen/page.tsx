import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  createShiftPlanTemplate,
  deleteShiftPlanTemplate,
} from '@/lib/data/shift-plan-templates';
import { listWeeklyShiftTemplates } from '@/lib/services/shift-plan';

import TemplateManager from './TemplateManager';

type ActionResult = {
  success: boolean;
  error?: string;
};

type TemplatePayload = {
  name: string;
  days: Array<{
    weekday: number;
    mode: 'available' | 'unavailable';
    start?: string | null;
    end?: string | null;
    pause?: number | null;
    label?: string | null;
  }>;
};

const NO_WORK_LABEL = 'Kein Arbeitstag';
const NO_WORK_LABEL_LOWER = NO_WORK_LABEL.toLowerCase();
const isNoWorkLabel = (label: string | null | undefined): boolean =>
  (label ?? '').trim().toLowerCase() === NO_WORK_LABEL_LOWER;

function sanitizePayload(raw: TemplatePayload): TemplatePayload {
  const name = (raw.name ?? '').trim();
  const days = Array.isArray(raw.days) ? raw.days : [];
  return {
    name,
    days: days
      .map((day) => ({
        weekday: Number(day.weekday),
        mode: day.mode === 'unavailable' ? 'unavailable' : 'available',
        start: typeof day.start === 'string' ? day.start : null,
        end: typeof day.end === 'string' ? day.end : null,
        pause: Number(day.pause ?? 0) || 0,
        label: typeof day.label === 'string' ? day.label : null,
      }))
      .filter((day) => Number.isInteger(day.weekday) && day.weekday >= 0 && day.weekday <= 6),
  };
}

export async function createTemplateAction(formData: FormData): Promise<ActionResult> {
  'use server';

  const session = await getServerAuthSession();
  if (!session?.user || session.user.roleId !== 2) {
    return { success: false, error: 'Keine Berechtigung.' };
  }

  const payloadRaw = formData.get('payload');
  if (typeof payloadRaw !== 'string' || !payloadRaw.trim()) {
    return { success: false, error: 'Ungültige Anfrage.' };
  }

  try {
    const parsed = JSON.parse(payloadRaw) as TemplatePayload;
    const payload = sanitizePayload(parsed);
    if (!payload.name) {
      return { success: false, error: 'Bitte einen Namen für die Vorlage angeben.' };
    }
    if (!payload.days.length) {
      return { success: false, error: 'Die Vorlage benötigt mindestens einen Tag.' };
    }

    createShiftPlanTemplate({
      name: payload.name,
      days: payload.days.map((day) => ({
        weekday: day.weekday,
        mode: day.mode,
        start:
          day.mode === 'available' || !isNoWorkLabel(day.label)
            ? day.start ?? null
            : null,
        end:
          day.mode === 'available' || !isNoWorkLabel(day.label)
            ? day.end ?? null
            : null,
        requiredPauseMinutes:
          day.mode === 'available' || !isNoWorkLabel(day.label) ? day.pause ?? 0 : 0,
        label: day.label?.trim() ? day.label.trim() : null,
      })),
    });

    revalidatePath(withAppBasePath('/admin/schichtplan/vorlagen'));
    revalidatePath(withAppBasePath('/admin/schichtplan'));

    return { success: true };
  } catch (error) {
    console.error('createTemplateAction', error);
    return { success: false, error: 'Vorlage konnte nicht gespeichert werden.' };
  }
}

export async function deleteTemplateAction(formData: FormData): Promise<ActionResult> {
  'use server';

  const session = await getServerAuthSession();
  if (!session?.user || session.user.roleId !== 2) {
    return { success: false, error: 'Keine Berechtigung.' };
  }

  const templateId = Number(formData.get('templateId'));
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return { success: false, error: 'Ungültige Vorlage.' };
  }

  try {
    deleteShiftPlanTemplate(templateId);
    revalidatePath(withAppBasePath('/admin/schichtplan/vorlagen'));
    revalidatePath(withAppBasePath('/admin/schichtplan'));
    return { success: true };
  } catch (error) {
    console.error('deleteTemplateAction', error);
    return { success: false, error: 'Vorlage konnte nicht gelöscht werden.' };
  }
}

export default async function TemplatePage() {
  const session = await getServerAuthSession();
  if (!session?.user) {
    redirect(withAppBasePath('/login'));
  }
  if (session.user.roleId !== 2) {
    redirect(withAppBasePath('/mitarbeiter'));
  }

  const templates = listWeeklyShiftTemplates();

  return (
    <TemplateManager
      templates={templates}
      createAction={createTemplateAction}
      deleteAction={deleteTemplateAction}
    />
  );
}
