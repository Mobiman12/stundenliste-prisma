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
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

function base64UrlEncode(value: string): string {
  const bytes = textEncoder.encode(value);
  let base64 = '';
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(bytes).toString('base64');
  } else {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding ? normalized.padEnd(normalized.length + 4 - padding, '=') : normalized;

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return textDecoder.decode(bytes);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const chunk = hex.slice(i, i + 2);
    const value = Number.parseInt(chunk, 16);
    if (Number.isNaN(value)) {
      return null;
    }
    bytes[i / 2] = value;
  }
  return bytes;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function hmacSha256(payload: string, secret: string): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is not available.');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload));
  return new Uint8Array(signature);
}

async function sign(payload: string): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  const signature = await hmacSha256(payload, secret);
  return bytesToHex(signature);
}

function decodeBase64Url(value: string): string {
  return base64UrlDecode(value);
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

export async function createTeamSessionToken(payload: TeamSessionPayload): Promise<string> {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = await sign(encoded);
  if (!sig) {
    throw new Error('TEAM_AUTH_SECRET ist nicht gesetzt.');
  }
  return `${encoded}.${sig}`;
}

export async function verifyTeamSession(cookieValue?: string | null): Promise<TeamSessionPayload | null> {
  if (!cookieValue) {
    return null;
  }

  const trimmed = cookieValue.trim();
  if (!trimmed) {
    return null;
  }

  const [payloadPart, signature] = trimmed.split('.');
  if (signature) {
    const expected = await sign(payloadPart);
    if (!expected) {
      return null;
    }
    const sigBytes = hexToBytes(signature);
    const expectedBytes = hexToBytes(expected);
    if (!sigBytes || !expectedBytes || !timingSafeEqualBytes(sigBytes, expectedBytes)) {
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
