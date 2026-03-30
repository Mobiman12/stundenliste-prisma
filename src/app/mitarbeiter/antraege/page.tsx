import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  getLeaveRequestsForEmployee,
  submitLeaveRequest,
  UNPAID_CONFIRMATION_REQUIRED,
  cancelLeaveRequestAsEmployee,
  type LeaveRequestView,
} from '@/lib/services/leave-requests';

import EmployeeLeaveRequestsClient, {
  type LeaveRequestFormState,
} from './EmployeeLeaveRequestsClient';

async function ensureEmployeeSession() {
  const session = await getServerAuthSession();
  if (!session?.user?.employeeId) {
    redirect(withAppBasePath('/login?mode=employee'));
  }
  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login?mode=employee'));
  }
  return { employeeId: session.user.employeeId, tenantId };
}

async function submitLeaveRequestAction(
  _prevState: LeaveRequestFormState,
  formData: FormData
): Promise<LeaveRequestFormState> {
  'use server';
  try {
    const { employeeId, tenantId } = await ensureEmployeeSession();

    const typeRaw = String(formData.get('type') ?? '').trim();
    const startDateRaw = String(formData.get('start_date') ?? '').trim();
    const endDateRaw = String(formData.get('end_date') ?? '').trim();
    const startTimeRaw = String(formData.get('start_time') ?? '').trim();
    const endTimeRaw = String(formData.get('end_time') ?? '').trim();
    const reasonValue = formData.get('reason');
    const allowUnpaidRaw = String(formData.get('allow_unpaid') ?? '').trim().toLowerCase();
    const reason =
      typeof reasonValue === 'string' ? reasonValue.trim() : null;
    const allowUnpaid = allowUnpaidRaw === '1' || allowUnpaidRaw === 'true' || allowUnpaidRaw === 'yes';

    const sanitizeTime = (value: string): string | null => {
      if (!value) return null;
      if (/^\d{1,2}:\d{2}$/.test(value)) {
        return value.padStart(5, '0');
      }
      return null;
    };

    const startTime = sanitizeTime(startTimeRaw);
    const endTime = sanitizeTime(endTimeRaw);
    if (typeRaw !== 'overtime' && typeRaw !== 'vacation') {
      return {
        status: 'error',
        message: 'Bitte zuerst die Art des Antrags auswählen.',
      };
    }
    const type = typeRaw;

    if (type === 'overtime') {
      if (!startTime || !endTime) {
        return {
          status: 'error',
          message: 'Bitte Start- und Endzeit für den Überstundenabbau angeben.',
        };
      }
    }

    await submitLeaveRequest(tenantId, {
      employeeId,
      type,
      startDate: startDateRaw,
      endDate: endDateRaw,
      startTime,
      endTime,
      reason,
      allowUnpaid,
    });

    revalidatePath(withAppBasePath('/mitarbeiter/antraege'));
    revalidatePath(withAppBasePath('/admin/antraege'));

    return {
      status: 'success',
      message: 'Dein Antrag wurde erfolgreich eingereicht.',
    };
  } catch (error) {
    console.error('Failed to submit leave request', error);
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
        message: `Der beantragte Urlaub überschreitet deinen Resturlaub (angefragt: ${requestedDays} Tage, verfügbar: ${availableDays} Tage, unbezahlt: ${unpaidDays} Tage).`,
        requiresUnpaidConfirmation: true,
        requestedDays,
        availableDays,
        unpaidDays,
      };
    }
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Der Antrag konnte nicht gesendet werden.',
    };
  }
}

async function manageLeaveRequestAction(
  _prevState: LeaveRequestFormState,
  formData: FormData
): Promise<LeaveRequestFormState> {
  'use server';
  try {
    const { employeeId, tenantId } = await ensureEmployeeSession();
    const requestIdRaw = String(formData.get('request_id') ?? '').trim();
    const modeRaw = String(formData.get('mode') ?? '').trim();
    const messageValue = formData.get('message');

    const requestId = Number.parseInt(requestIdRaw, 10);
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return { status: 'error', message: 'Ungültige Antragsnummer.' };
    }

    if (modeRaw !== 'cancel_pending' && modeRaw !== 'request_cancellation') {
      return { status: 'error', message: 'Ungültige Aktion.' };
    }
    const mode = modeRaw as 'cancel_pending' | 'request_cancellation';

    const message =
      typeof messageValue === 'string' ? messageValue.trim() : null;

    const result = await cancelLeaveRequestAsEmployee(tenantId, {
      employeeId,
      requestId,
      mode,
      message,
    });

    if (result === 'cancelled') {
      return {
        status: 'success',
        message: 'Der Antrag wurde storniert.',
      };
    }

    return {
      status: 'success',
      message: 'Stornierung wurde zur Genehmigung eingereicht.',
    };
  } catch (error) {
    console.error('Failed to cancel leave request', error);
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Die Stornierung konnte nicht verarbeitet werden.',
    };
  }
}

export default async function EmployeeLeaveRequestsPage() {
  const { employeeId, tenantId } = await ensureEmployeeSession();
  const requests: LeaveRequestView[] =
    await getLeaveRequestsForEmployee(tenantId, employeeId);

  return (
    <EmployeeLeaveRequestsClient
      requests={requests}
      submitAction={submitLeaveRequestAction}
      cancelAction={manageLeaveRequestAction}
    />
  );
}
