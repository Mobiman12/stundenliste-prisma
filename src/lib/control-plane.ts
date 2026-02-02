export type TenantShiftPlanSettings = {
  allowEmployeeSelfPlan: boolean;
};

export type StaffShiftPlanSettings = {
  allowEmployeeSelfPlan: boolean;
  staffId?: string | null;
};

export type TillhubConfig = {
  enabled: boolean;
  provider?: string | null;
  apiBase?: string | null;
  loginId?: string | null;
  accountId?: string | null;
  email?: string | null;
  password?: string | null;
  staticToken?: string | null;
};

export type TenantThemeSettings = {
  preset?: string | null;
  mode?: string | null;
};

const DEFAULT_SHIFT_PLAN_SETTINGS: TenantShiftPlanSettings = {
  allowEmployeeSelfPlan: false,
};

const DEFAULT_STAFF_SHIFT_PLAN_SETTINGS: StaffShiftPlanSettings = {
  allowEmployeeSelfPlan: false,
};

const DEFAULT_TILLHUB_CONFIG: TillhubConfig = {
  enabled: false,
  provider: "TILLHUB",
  apiBase: null,
  loginId: null,
  accountId: null,
  email: null,
  password: null,
  staticToken: null,
};

export async function fetchTenantThemeSettings(tenantId: string): Promise<TenantThemeSettings | null> {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  const secret = process.env.PROVISION_SECRET?.trim();
  if (!baseUrl) {
    return null;
  }

  const url = new URL("/api/internal/tenant/info", baseUrl);
  url.searchParams.set("tenantId", tenantId);

  try {
    const response = await fetch(url, {
      headers: secret ? { "x-provision-secret": secret } : undefined,
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json().catch(() => null)) as { theme?: TenantThemeSettings } | null;
    return payload?.theme ?? null;
  } catch (error) {
    console.warn("[theme] failed to load tenant settings", error);
  }

  return null;
}

export async function fetchTenantShiftPlanSettings(
  tenantId: string,
): Promise<TenantShiftPlanSettings> {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  const secret = process.env.PROVISION_SECRET;
  if (!baseUrl || !secret) {
    return DEFAULT_SHIFT_PLAN_SETTINGS;
  }

  const url = new URL('/api/internal/tenant/info', baseUrl);
  url.searchParams.set('tenantId', tenantId);

  try {
    const response = await fetch(url, {
      headers: {
        'x-provision-secret': secret,
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      return DEFAULT_SHIFT_PLAN_SETTINGS;
    }
    const payload = (await response.json().catch(() => null)) as {
      shiftPlan?: TenantShiftPlanSettings;
    } | null;
    if (payload?.shiftPlan && typeof payload.shiftPlan.allowEmployeeSelfPlan === 'boolean') {
      return payload.shiftPlan;
    }
  } catch (error) {
    console.warn('[shift-plan] failed to load tenant settings', error);
  }

  return DEFAULT_SHIFT_PLAN_SETTINGS;
}

export async function fetchTillhubConfig(tenantId: string): Promise<TillhubConfig> {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  const secret = process.env.PROVISION_SECRET;
  if (!baseUrl || !secret) {
    return DEFAULT_TILLHUB_CONFIG;
  }

  const url = new URL("/api/internal/tillhub/config", baseUrl);
  url.searchParams.set("tenantId", tenantId);

  try {
    const response = await fetch(url, {
      headers: {
        "x-provision-secret": secret,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      return DEFAULT_TILLHUB_CONFIG;
    }
    const payload = (await response.json().catch(() => null)) as {
      tillhub?: TillhubConfig;
    } | null;
    if (payload?.tillhub) {
      return {
        ...DEFAULT_TILLHUB_CONFIG,
        ...payload.tillhub,
      };
    }
  } catch (error) {
    console.warn("[tillhub] failed to load config", error);
  }

  return DEFAULT_TILLHUB_CONFIG;
}

export async function fetchStaffShiftPlanSettings(params: {
  tenantId: string;
  staffId?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
}): Promise<StaffShiftPlanSettings> {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  const secret = process.env.PROVISION_SECRET;
  if (!baseUrl || !secret) {
    return DEFAULT_STAFF_SHIFT_PLAN_SETTINGS;
  }

  const tenantId = params.tenantId.trim();
  const staffId = params.staffId?.trim();
  const email = params.email?.trim();
  const firstName = params.firstName?.trim();
  const lastName = params.lastName?.trim();
  const displayName = params.displayName?.trim();
  if (!tenantId || !(staffId || email || firstName || lastName || displayName)) {
    return DEFAULT_STAFF_SHIFT_PLAN_SETTINGS;
  }

  const url = new URL('/api/internal/staff/shift-plan', baseUrl);
  url.searchParams.set('tenantId', tenantId);
  if (staffId) url.searchParams.set('staffId', staffId);
  if (email) url.searchParams.set('email', email);
  if (firstName) url.searchParams.set('firstName', firstName);
  if (lastName) url.searchParams.set('lastName', lastName);
  if (displayName) url.searchParams.set('displayName', displayName);

  try {
    const response = await fetch(url, {
      headers: {
        'x-provision-secret': secret,
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      return DEFAULT_STAFF_SHIFT_PLAN_SETTINGS;
    }
    const payload = (await response.json().catch(() => null)) as {
      staffId?: string | null;
      shiftPlan?: { allowEmployeeSelfPlan?: boolean };
    } | null;
    const allowEmployeeSelfPlan =
      payload?.shiftPlan && typeof payload.shiftPlan.allowEmployeeSelfPlan === 'boolean'
        ? payload.shiftPlan.allowEmployeeSelfPlan
        : DEFAULT_STAFF_SHIFT_PLAN_SETTINGS.allowEmployeeSelfPlan;
    return {
      allowEmployeeSelfPlan,
      staffId: typeof payload?.staffId === 'string' && payload.staffId.trim() ? payload.staffId.trim() : null,
    };
  } catch (error) {
    console.warn('[shift-plan] failed to load staff settings', error);
  }

  return DEFAULT_STAFF_SHIFT_PLAN_SETTINGS;
}

export async function pushShiftPlanDayToControlPlane(params: {
  tenantId: string;
  staffId?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  isoDate: string;
  start?: string | null;
  end?: string | null;
  pause?: number | null;
  label?: string | null;
  branchId?: number | null;
  segmentIndex?: number | null;
  mode?: "available" | "unavailable" | null;
}) {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  const secret = process.env.PROVISION_SECRET;
  if (!baseUrl || !secret) {
    return;
  }

  const url = new URL("/api/internal/shift-plan/day", baseUrl);
  const payload = {
    tenantId: params.tenantId,
    staffId: params.staffId ?? null,
    email: params.email ?? null,
    firstName: params.firstName ?? null,
    lastName: params.lastName ?? null,
    displayName: params.displayName ?? null,
    isoDate: params.isoDate,
    start: params.start ?? null,
    end: params.end ?? null,
    pause: params.pause ?? 0,
    label: params.label ?? null,
    branchId: params.branchId ?? null,
    segmentIndex: params.segmentIndex ?? null,
    mode: params.mode ?? null,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-provision-secret": secret,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      console.warn("[shift-plan] control-plane sync failed", response.status, text);
    }
  } catch (error) {
    console.warn("[shift-plan] control-plane sync failed", error);
  }
}
