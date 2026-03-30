'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  createManualApprovedVacation,
  decideLeaveRequestRange,
  UNPAID_CONFIRMATION_REQUIRED,
} from '@/lib/services/leave-requests';
import { createVacationLock, deactivateVacationLock } from '@/lib/data/vacation-locks';

export type VacationPlanActionState = {
  status: 'idle' | 'success' | 'error';
  message: string | null;
  requiresUnpaidConfirmation?: boolean;
  requestedDays?: number;
  availableDays?: number;
  unpaidDays?: number;
};

export async function ensureAdminSession() {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.roleId !== 2) {
    redirect(withAppBasePath('/login'));
  }
  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login'));
  }
  return { adminId: session.user.id, tenantId };
}

function normalizeIsoDate(input: string, fieldLabel: string): string {
  const value = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldLabel} muss im Format JJJJ-MM-TT angegeben werden.`);
  }
  return value;
}

export async function decideVacationRequestRangeAction(
  _prevState: VacationPlanActionState,
  formData: FormData,
): Promise<VacationPlanActionState> {
  try {
    const { tenantId, adminId } = await ensureAdminSession();
    const requestId = Number.parseInt(String(formData.get('request_id') ?? '0'), 10);
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return { status: 'error', message: 'Ungültige Antragsnummer.' };
    }
    const decision = String(formData.get('decision') ?? '').trim().toLowerCase();
    const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : null;
    if (!status) {
      return { status: 'error', message: 'Ungültige Entscheidung.' };
    }
    const rangeStart = normalizeIsoDate(String(formData.get('range_start') ?? ''), 'Startdatum');
    const rangeEnd = normalizeIsoDate(String(formData.get('range_end') ?? ''), 'Enddatum');
    const adminNoteRaw = formData.get('admin_note');
    const adminNote = typeof adminNoteRaw === 'string' && adminNoteRaw.trim().length ? adminNoteRaw.trim() : null;

    await decideLeaveRequestRange(tenantId, {
      requestId,
      status,
      adminId,
      rangeStart,
      rangeEnd,
      adminNote,
    });

    revalidatePath('/admin/antraege');
    revalidatePath('/admin/urlaubsplan');
    revalidatePath('/mitarbeiter/antraege');
    revalidatePath('/mitarbeiter/schichtplan');

    return {
      status: 'success',
      message:
        status === 'approved'
          ? 'Urlaubseintrag wurde genehmigt.'
          : 'Urlaubseintrag wurde abgelehnt.',
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Entscheidung konnte nicht gespeichert werden.',
    };
  }
}

export async function createManualVacationAction(
  _prevState: VacationPlanActionState,
  formData: FormData,
): Promise<VacationPlanActionState> {
  try {
    const { tenantId, adminId } = await ensureAdminSession();
    const employeeId = Number.parseInt(String(formData.get('employee_id') ?? '0'), 10);
    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      return { status: 'error', message: 'Mitarbeiter fehlt.' };
    }

    const startDate = normalizeIsoDate(String(formData.get('start_date') ?? ''), 'Startdatum');
    const endDate = normalizeIsoDate(String(formData.get('end_date') ?? ''), 'Enddatum');
    const noteRaw = formData.get('note');
    const allowUnpaidRaw = String(formData.get('allow_unpaid') ?? '').trim().toLowerCase();
    const adminNote = typeof noteRaw === 'string' && noteRaw.trim().length ? noteRaw.trim() : null;
    const allowUnpaid = allowUnpaidRaw === '1' || allowUnpaidRaw === 'true' || allowUnpaidRaw === 'yes';

    await createManualApprovedVacation(tenantId, {
      employeeId,
      startDate,
      endDate,
      adminId,
      adminNote,
      allowUnpaid,
    });

    revalidatePath('/admin/antraege');
    revalidatePath('/admin/urlaubsplan');
    revalidatePath('/mitarbeiter/antraege');
    revalidatePath('/mitarbeiter/schichtplan');

    return { status: 'success', message: 'Urlaub wurde manuell eingetragen und im Schichtplan hinterlegt.' };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${UNPAID_CONFIRMATION_REQUIRED}|`)) {
      const requestedDays = Number.parseFloat(
        /requested=([0-9]+(?:\.[0-9]+)?)/.exec(error.message)?.[1] ?? '0',
      );
      const availableDays = Number.parseFloat(
        /available=([0-9]+(?:\.[0-9]+)?)/.exec(error.message)?.[1] ?? '0',
      );
      const unpaidDays = Number.parseFloat(
        /unpaid=([0-9]+(?:\.[0-9]+)?)/.exec(error.message)?.[1] ?? '0',
      );
      return {
        status: 'error',
        message: `Resturlaub reicht nicht aus (angefragt: ${requestedDays} Tage, verfügbar: ${availableDays} Tage, unbezahlt: ${unpaidDays} Tage).`,
        requiresUnpaidConfirmation: true,
        requestedDays,
        availableDays,
        unpaidDays,
      };
    }
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Manueller Urlaub konnte nicht gespeichert werden.',
    };
  }
}

export async function createVacationLockAction(
  _prevState: VacationPlanActionState,
  formData: FormData,
): Promise<VacationPlanActionState> {
  try {
    const { tenantId, adminId } = await ensureAdminSession();
    const branchIdRaw = String(formData.get('branch_id') ?? '').trim();
    const branchId = branchIdRaw.length ? Number.parseInt(branchIdRaw, 10) : null;
    if (branchIdRaw.length && (!Number.isFinite(branchId) || Number(branchId) <= 0)) {
      return { status: 'error', message: 'Ungültiger Standort.' };
    }
    const startDate = normalizeIsoDate(String(formData.get('start_date') ?? ''), 'Startdatum');
    const endDate = normalizeIsoDate(String(formData.get('end_date') ?? ''), 'Enddatum');
    const reasonRaw = formData.get('reason');
    const reason = typeof reasonRaw === 'string' && reasonRaw.trim().length ? reasonRaw.trim() : null;

    await createVacationLock({
      tenantId,
      branchId,
      startDate,
      endDate,
      reason,
      createdByAdminId: adminId,
    });

    revalidatePath('/admin/urlaubsplan');
    return { status: 'success', message: 'Urlaubssperre wurde gespeichert.' };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Urlaubssperre konnte nicht gespeichert werden.',
    };
  }
}

export async function deactivateVacationLockAction(
  _prevState: VacationPlanActionState,
  formData: FormData,
): Promise<VacationPlanActionState> {
  try {
    const { tenantId } = await ensureAdminSession();
    const lockId = Number.parseInt(String(formData.get('lock_id') ?? '0'), 10);
    if (!Number.isFinite(lockId) || lockId <= 0) {
      return { status: 'error', message: 'Ungültige Sperre.' };
    }
    await deactivateVacationLock(tenantId, lockId);
    revalidatePath('/admin/urlaubsplan');
    return { status: 'success', message: 'Urlaubssperre wurde deaktiviert.' };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Urlaubssperre konnte nicht deaktiviert werden.',
    };
  }
}
