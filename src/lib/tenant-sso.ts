import { createHmac } from "crypto";

export type TenantSsoApp = "TIMESHIFT" | "CALENDAR" | "WEBSITE" | "STAFF_CORE";

export interface TenantSsoPayload {
  tenantId: string;
  tenantSlug: string;
  tenantName?: string | null;
  email?: string | null;
  app: TenantSsoApp;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  iat: number;
  exp: number;
  returnTo?: string | null;
  staffCode?: string | null;
  role?: string | null;
}

const DEFAULT_TTL_MS = 2 * 60 * 1000;

function getSsoSecret() {
  const secret = process.env.TENANT_SSO_SECRET || process.env.TENANT_AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TENANT_SSO_SECRET ist nicht gesetzt.");
    }
    return "dev-sso-secret";
  }
  return secret;
}

export function createTenantSsoToken(
  payload: Omit<TenantSsoPayload, "iat" | "exp">,
  ttlMs = DEFAULT_TTL_MS,
) {
  const iat = Date.now();
  const exp = iat + ttlMs;
  const data = { ...payload, iat, exp };
  const json = JSON.stringify(data);
  const sig = createHmac("sha256", getSsoSecret()).update(json).digest("hex");
  return Buffer.from(`${json}.${sig}`, "utf8").toString("base64url");
}
