import {
  getLeaveRequestsForAdmin,
  type LeaveRequestView,
} from '@/lib/services/leave-requests';

import AdminLeaveRequestsClient from './AdminLeaveRequestsClient';
import { decideLeaveRequestAction, ensureAdminSession } from './actions';

export default async function AdminLeaveRequestsPage() {
  const { tenantId } = await ensureAdminSession();
  const requests: LeaveRequestView[] = await getLeaveRequestsForAdmin(tenantId, 'all');

  return <AdminLeaveRequestsClient requests={requests} decideAction={decideLeaveRequestAction} />;
}
