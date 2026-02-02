import { redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { withAppBasePath } from '@/lib/routes';
import {
  decideLeaveRequest,
  getLeaveRequestsForAdmin,
  adminConfirmCancellation,
  adminRejectCancellationRequest,
  type LeaveRequestView,
} from '@/lib/services/leave-requests';

import AdminLeaveRequestsClient, {
  type DecideRequestFormState,
} from './AdminLeaveRequestsClient';

async function ensureAdminSession() {
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

export async function decideLeaveRequestAction(
  _prevState: DecideRequestFormState,
  formData: FormData
): Promise<DecideRequestFormState> {
  'use server';

  try {
    const { adminId, tenantId } = await ensureAdminSession();

    const requestId = Number.parseInt(String(formData.get('request_id') ?? '0'), 10);
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return { status: 'error', message: 'Ungültiger Antrag.' };
    }

    const decisionRaw = String(formData.get('decision') ?? '').trim().toLowerCase();
    const noteValue = formData.get('admin_note');
    const adminNote =
      typeof noteValue === 'string' && noteValue.trim().length ? noteValue.trim() : null;

    if (decisionRaw === 'approve' || decisionRaw === 'reject') {
      const status = decisionRaw === 'reject' ? 'rejected' : 'approved';
      await decideLeaveRequest(tenantId, {
        requestId,
        status,
        adminId,
        adminNote,
      });
      return {
        status: 'success',
        message:
          status === 'approved'
            ? 'Antrag wurde genehmigt und im Schichtplan hinterlegt.'
            : 'Antrag wurde abgelehnt.',
      };
    }

    if (decisionRaw === 'cancel_confirm') {
      await adminConfirmCancellation(tenantId, {
        requestId,
        adminId,
        adminNote,
      });
      return {
        status: 'success',
        message: 'Die Stornierung wurde bestätigt und aus dem Schichtplan entfernt.',
      };
    }

    if (decisionRaw === 'cancel_deny') {
      await adminRejectCancellationRequest(tenantId, {
        requestId,
        adminId,
        adminNote,
      });
      return {
        status: 'success',
        message: 'Die Stornierung wurde abgelehnt. Der Antrag bleibt aktiv.',
      };
    }

    return { status: 'error', message: 'Unbekannte Aktion.' };
  } catch (error) {
    console.error('Failed to decide leave request', error);
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Die Entscheidung konnte nicht gespeichert werden.',
    };
  }
}

export default async function AdminLeaveRequestsPage() {
  const { tenantId } = await ensureAdminSession();
  const requests: LeaveRequestView[] = await getLeaveRequestsForAdmin(tenantId, 'all');

  return <AdminLeaveRequestsClient requests={requests} decideAction={decideLeaveRequestAction} />;
}
