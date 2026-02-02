import { createHmac, timingSafeEqual } from 'crypto';

export interface TeamSessionPayload {
  username: string;
  role?: string | null;
  tenantId?: string | null;
  tenantSlug?: string | null;
  tenantName?: string | null;
  email?: string | null;
  app?: string | null;
  expiresAt: number;
  [key: string]: unknown;
}

export const SESSION_COOKIE = process.env.TEAM_SESSION_COOKIE ?? 'mc_session';
const DEV_FALLBACK_SECRET = 'dev-team-secret';

function getSecret() {
  const secret = process.env.TEAM_AUTH_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return null;
    }
    return DEV_FALLBACK_SECRET;
  }
  return secret;
}

function sign(payload: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding ? normalized.padEnd(normalized.length + 4 - padding, '=') : normalized;

  if (typeof atob === 'function') {
    return atob(padded);
  }

  // Node.js fallback
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  throw new Error('Base64 decoding is not supported in this environment.');
}

function parsePayload(part: string): TeamSessionPayload | null {
  try {
    const json = decodeBase64Url(part);
    const parsed = JSON.parse(json) as TeamSessionPayload;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('[team-auth] Unable to parse session payload', error);
    return null;
  }
}

function isExpired(payload: TeamSessionPayload | null): boolean {
  if (!payload) return true;
  const expires = Number(payload.expiresAt);
  return !Number.isFinite(expires) || Date.now() > expires;
}

export function createTeamSessionToken(payload: TeamSessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = sign(encoded);
  if (!sig) {
    throw new Error('TEAM_AUTH_SECRET ist nicht gesetzt.');
  }
  return `${encoded}.${sig}`;
}

export function verifyTeamSession(cookieValue?: string | null): TeamSessionPayload | null {
  if (!cookieValue) {
    return null;
  }

  const trimmed = cookieValue.trim();
  if (!trimmed) {
    return null;
  }

  const [payloadPart, signature] = trimmed.split('.');
  if (signature) {
    const expected = sign(payloadPart);
    if (!expected) {
      return null;
    }
    const sigBuf = Buffer.from(signature, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
  } else if (process.env.NODE_ENV === 'production') {
    return null;
  }

  const payload = parsePayload(payloadPart ?? trimmed);
  if (!payload || typeof payload.username !== 'string' || !payload.username.trim()) {
    return null;
  }

  if (isExpired(payload)) {
    return null;
  }

  return {
    ...payload,
    username: payload.username.trim(),
    expiresAt: Number(payload.expiresAt),
  };
}
