import { URL } from 'url';
import { fetchTillhubConfig, type TillhubConfig } from '@/lib/control-plane';

const DEFAULT_BASE_URL = 'https://api.tillhub.com/api/v0';
const CONFIG_TTL_MS = 5 * 60 * 1000;

const configCache = new Map<string, { value: TillhubConfig | null; expiresAt: number }>();

type TillhubRequestOptions = {
  path: string;
  searchParams?: Record<string, string | undefined | null>;
};

type TillhubLoginResponse = {
  token?: string | null;
  expires_at?: string | null;
  status?: number;
  msg?: string;
};

type CachedToken = { value: string; expiresAt: number | null };
type CachedTenantToken = { token: CachedToken; tenantId: string | null };

let cachedToken: CachedToken | null = null;
let cachedTenantToken: CachedTenantToken | null = null;

function getEnv(name: string, required = true): string | undefined {
  const value = process.env[name];
  if (required && (!value || !value.trim())) {
    throw new Error(`Environment variable ${name} is not set`);
  }
  return value?.trim();
}

function getBaseUrl(config?: TillhubConfig | null): string {
  return (config?.apiBase?.trim() || process.env.TILLHUB_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function buildUrl({ path, searchParams }: TillhubRequestOptions, config?: TillhubConfig | null): string {
  const baseUrl = getBaseUrl(config);
  const url = new URL(`${baseUrl}/${path.replace(/^\/+/, '')}`);
  if (searchParams) {
    for (const [key, raw] of Object.entries(searchParams)) {
      if (raw) {
        url.searchParams.set(key, raw);
      }
    }
  }
  return url.toString();
}

async function resolveTillhubConfig(tenantId?: string | null): Promise<TillhubConfig | null> {
  const trimmed = tenantId?.trim();
  if (!trimmed) {
    return null;
  }
  const cached = configCache.get(trimmed);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  try {
    const config = await fetchTillhubConfig(trimmed);
    configCache.set(trimmed, { value: config, expiresAt: now + CONFIG_TTL_MS });
    return config;
  } catch (error) {
    console.warn('[tillhub] failed to load control-plane config', error);
    configCache.set(trimmed, { value: null, expiresAt: now + CONFIG_TTL_MS });
    return null;
  }
}

async function getTillhubToken(config?: TillhubConfig | null, tenantId?: string | null): Promise<string> {
  if (config?.staticToken) {
    return config.staticToken;
  }

  const now = Date.now();
  if (
    cachedTenantToken &&
    cachedTenantToken.tenantId === (tenantId ?? null) &&
    (!cachedTenantToken.token.expiresAt || cachedTenantToken.token.expiresAt > now + 60_000)
  ) {
    return cachedTenantToken.token.value;
  }
  if (cachedToken && (!cachedToken.expiresAt || cachedToken.expiresAt > now + 60_000)) {
    return cachedToken.value;
  }

  const staticToken = config?.staticToken || getEnv('TILLHUB_STATIC_TOKEN', false);
  if (staticToken) {
    cachedToken = { value: staticToken, expiresAt: null };
    return staticToken;
  }

  const email = config?.email || getEnv('TILLHUB_EMAIL');
  const password = config?.password || getEnv('TILLHUB_PASSWORD');

  const baseUrl = getBaseUrl(config);
  const response = await fetch(`${baseUrl}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Tillhub login failed (${response.status}): ${body}`);
  }

  const json = (await response.json()) as TillhubLoginResponse;
  const token = json.token?.trim();
  if (!token) {
    throw new Error('Tillhub login returned no token');
  }
  const expiresAt = json.expires_at ? Date.parse(json.expires_at) : null;
  const nextToken = { value: token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null };
  cachedToken = nextToken;
  cachedTenantToken = { token: nextToken, tenantId: tenantId ?? null };
  return token;
}

async function tillhubFetch<T>(
  options: TillhubRequestOptions,
  config?: TillhubConfig | null,
  tenantId?: string | null
): Promise<T> {
  const token = await getTillhubToken(config, tenantId);
  const url = buildUrl(options, config);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Tillhub request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

export type TillhubStaffOverviewResponse = {
  results?: unknown;
  data?: unknown;
  [key: string]: unknown;
};

function findFirstNumber(entry: Record<string, unknown>, candidates: string[]): number | null {
  for (const key of candidates) {
    const value = entry[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function extractStaffGross(entry: unknown, staffId: string): number | null {
  if (!entry || typeof entry !== 'object') return null;
  const obj = entry as Record<string, unknown>;
  const nested = (value: unknown, key: string): unknown =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;

  const candidates: Array<string | undefined> = [
    obj.staff_id as string | undefined,
    obj.staffId as string | undefined,
    obj.staff_uuid as string | undefined,
    nested(obj.staff, 'id') as string | undefined,
    nested(obj.staff, 'uuid') as string | undefined,
    obj.user_id as string | undefined,
    obj.userId as string | undefined,
    nested(obj.user, 'id') as string | undefined,
    obj.id as string | undefined,
    obj.staff_number as string | undefined,
  ].filter(Boolean);
  const normalizedStaff = staffId.trim().toLowerCase();
  const matches = candidates.some((value) => String(value).trim().toLowerCase() === normalizedStaff);
  if (!matches) return null;

  const numeric = findFirstNumber(entry, [
    'amount_gross_total',
    'brutto',
    'gross',
    'gross_total',
    'total_gross',
    'revenue',
    'revenue_gross',
    'sales',
    'sales_total',
    'total',
    'amount',
    'sum',
  ]);
  return numeric;
}

function flattenResults(payload: unknown): unknown[] {
  if (!payload) return [];
  const buckets: unknown[] = [];
  if (Array.isArray(payload)) {
    for (const item of payload) {
      buckets.push(item);
      if (item && typeof item === 'object') {
        buckets.push(...flattenResults((item as { results?: unknown; data?: unknown; values?: unknown }).results));
        buckets.push(...flattenResults((item as { results?: unknown; data?: unknown; values?: unknown }).data));
        buckets.push(...flattenResults((item as { results?: unknown; data?: unknown; values?: unknown }).values));
      }
    }
  } else if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.results)) buckets.push(...obj.results);
    if (Array.isArray(obj.data)) buckets.push(...obj.data);
    if (Array.isArray(obj.values)) buckets.push(...obj.values);
  }
  return buckets;
}

export async function fetchTillhubStaffOverview(params?: {
  start?: string | null;
  end?: string | null;
  from?: string | null; // legacy naming
  to?: string | null; // legacy naming
  accountId?: string | null;
  tenantId?: string | null;
}): Promise<TillhubStaffOverviewResponse> {
  const config = await resolveTillhubConfig(params?.tenantId ?? null);
  const loginId = config?.loginId || getEnv('TILLHUB_LOGIN_ID');
  const path = `analytics/${loginId}/reports/staff/overview`;

  const start = params?.start ?? params?.from ?? undefined;
  const end = params?.end ?? params?.to ?? undefined;
  const account = params?.accountId ?? config?.accountId ?? process.env.TILLHUB_ACCOUNT_ID ?? undefined;
  const searchParams: Record<string, string | undefined | null> = {
    start,
    end,
    account,
  };

  return tillhubFetch<TillhubStaffOverviewResponse>( { path, searchParams }, config, params?.tenantId ?? null);
}

export async function fetchTillhubDailyGrossForStaff(options: {
  staffId: string;
  date: string;
  accountId?: string | null;
  tenantId?: string | null;
}): Promise<{ gross: number | null; raw: TillhubStaffOverviewResponse }> {
  const { staffId, date, accountId } = options;
  const start = `${date}T00:00:00.000Z`;
  const end = `${date}T23:59:59.999Z`;
  const overview = await fetchTillhubStaffOverview({
    start,
    end,
    accountId: accountId ?? undefined,
    tenantId: options.tenantId ?? null,
  });

  const buckets = flattenResults(overview.results ?? overview.data ?? overview);
  let gross: number | null = null;
  for (const bucket of buckets) {
    const candidate = extractStaffGross(bucket, staffId);
    if (candidate !== null) {
      gross = candidate;
      break;
    }
  }

  return { gross, raw: overview };
}
