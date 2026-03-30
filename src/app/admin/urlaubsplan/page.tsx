import { getVacationPlannerData } from '@/lib/services/admin/vacation-planner';

import VacationPlannerClient from './VacationPlannerClient';
import {
  createManualVacationAction,
  createVacationLockAction,
  deactivateVacationLockAction,
  decideVacationRequestRangeAction,
  ensureAdminSession,
} from './actions';

type SearchParams = {
  year?: string;
  branchId?: string;
};

function parseYear(value: string | undefined): number {
  const nowYear = new Date().getFullYear();
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return nowYear;
  if (parsed < 2020) return 2020;
  if (parsed > nowYear + 2) return nowYear + 2;
  return parsed;
}

function parseBranchId(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export default async function AdminVacationPlanPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { tenantId } = await ensureAdminSession();
  const params = (await searchParams) ?? {};
  const year = parseYear(params.year);
  const branchId = parseBranchId(params.branchId);

  const plannerData = await getVacationPlannerData(tenantId, year, branchId);

  return (
    <VacationPlannerClient
      data={plannerData}
      decideRangeAction={decideVacationRequestRangeAction}
      createManualVacationAction={createManualVacationAction}
      createVacationLockAction={createVacationLockAction}
      deactivateVacationLockAction={deactivateVacationLockAction}
    />
  );
}
