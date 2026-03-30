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

export type StaffProfileUpdatePayload = {
  tenantId: string;
  staffId: string;
  email?: string | null;
  phone?: string | null;
  bookingPin?: string | null;
  password?: string | null;
  passwordHash?: string | null;
  profile?: {
    street?: string | null;
    houseNumber?: string | null;
    zipCode?: string | null;
    city?: string | null;
    country?: string | null;
    federalState?: string | null;
    birthDate?: string | null;
    phones?: Array<{ type: string; number: string }> | null;
  } | null;
};

export type StaffLifecycleUpdatePayload = {
  tenantId: string;
  staffId: string;
  action: "deactivate";
  reason?: string | null;
};

export type StaffUpsertPayload = {
  tenantId: string;
  staffId?: string | null;
  isActive?: boolean;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  bookingPin?: string | null;
  passwordHash?: string | null;
  showInCalendar?: boolean;
  apps?: {
    calendar?: boolean;
    timeshift?: boolean;
    website?: boolean;
  } | null;
  profile?: {
    street?: string | null;
    houseNumber?: string | null;
    zipCode?: string | null;
    city?: string | null;
    country?: string | null;
    federalState?: string | null;
    birthDate?: string | null;
    phones?: Array<{ type: string; number: string }> | null;
  } | null;
};

export type StaffUpsertResult = {
  staffId: string;
  created: boolean;
};

export async function pushStaffProfileUpdateToControlPlane(payload: StaffProfileUpdatePayload): Promise<boolean> {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  const secret = process.env.PROVISION_SECRET?.trim();
  if (!baseUrl || !secret) {
    return false;
  }

  try {
    const response = await fetch(new URL("/api/internal/staff/profile", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-provision-secret": secret,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    return response.ok;
  } catch (error) {
    console.warn("[staff-profile] control-plane update failed", error);
    return false;
  }
}

export async function pushStaffLifecycleUpdateToControlPlane(
  payload: StaffLifecycleUpdatePayload,
): Promise<boolean> {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  const secret = process.env.PROVISION_SECRET?.trim();
  if (!baseUrl || !secret) {
    return false;
  }

  try {
    const response = await fetch(new URL("/api/internal/staff/lifecycle", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-provision-secret": secret,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    return response.ok;
  } catch (error) {
    console.warn("[staff-lifecycle] control-plane update failed", error);
    return false;
  }
}

export async function upsertStaffInControlPlane(
  payload: StaffUpsertPayload
): Promise<StaffUpsertResult | null> {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  const secret = process.env.PROVISION_SECRET?.trim();
  if (!baseUrl || !secret) {
    return null;
  }

  try {
    const response = await fetch(new URL("/api/internal/staff/upsert", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-provision-secret": secret,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn("[staff-upsert] control-plane upsert failed", response.status, text);
      return null;
    }
    const body = (await response.json().catch(() => null)) as {
      staffId?: string | null;
      created?: boolean;
    } | null;
    const staffId = typeof body?.staffId === "string" ? body.staffId.trim() : "";
    if (!staffId) {
      return null;
    }
    return {
      staffId,
      created: body?.created === true,
    };
  } catch (error) {
    console.warn("[staff-upsert] control-plane upsert failed", error);
    return null;
  }
}

export type StaffPhotoUpdatePayload = {
  tenantId: string;
  staffId: string;
  photoUrl?: string | null;
  photoBase64?: string | null;
  photoMimeType?: string | null;
};

export async function pushStaffPhotoUpdateToControlPlane(
  payload: StaffPhotoUpdatePayload
): Promise<boolean> {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  const secret = process.env.PROVISION_SECRET?.trim();
  if (!baseUrl || !secret) {
    return false;
  }

  try {
    const response = await fetch(new URL('/api/internal/staff/photo', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-provision-secret': secret,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    return response.ok;
  } catch (error) {
    console.warn('[staff-photo] control-plane update failed', error);
    return false;
  }
}

export async function sendStaffPasswordActivationLinkToControlPlane(payload: {
  tenantId: string;
  staffId: string;
}): Promise<boolean> {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  const secret = process.env.PROVISION_SECRET?.trim();
  if (!baseUrl || !secret) {
    return false;
  }

  try {
    const response = await fetch(new URL('/api/internal/staff/password-activation', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-provision-secret': secret,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    return response.ok;
  } catch (error) {
    console.warn('[staff-activation] control-plane send failed', error);
    return false;
  }
}

export type StaffProfileSnapshot = {
  street?: string | null;
  houseNumber?: string | null;
  zipCode?: string | null;
  city?: string | null;
  country?: string | null;
  federalState?: string | null;
  birthDate?: string | null;
};

export async function fetchStaffProfileFromControlPlane(params: {
  tenantId: string;
  staffId: string;
}): Promise<StaffProfileSnapshot | null> {
  const baseUrl = process.env.CONTROL_PLANE_URL?.trim();
  const secret = process.env.PROVISION_SECRET?.trim();
  if (!baseUrl || !secret) {
    return null;
  }

  try {
    const url = new URL("/api/internal/staff/profile", baseUrl);
    url.searchParams.set("tenantId", params.tenantId);
    url.searchParams.set("staffId", params.staffId);
    const response = await fetch(url, {
      headers: {
        "x-provision-secret": secret,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as {
      profile?: StaffProfileSnapshot | null;
    } | null;
    if (!payload?.profile || typeof payload.profile !== "object") {
      return null;
    }
    return payload.profile;
  } catch (error) {
    console.warn("[staff-profile] control-plane fetch failed", error);
    return null;
  }
}

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
