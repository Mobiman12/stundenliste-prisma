import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';

import { getPrisma } from '@/lib/prisma';

export type AccountType = 'employee' | 'admin';

export interface BaseUser {
  id: number;
  username: string;
  roleId: number;
  accountType: AccountType;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  employeeId?: number | null;
}

export interface AuthenticatedUser extends BaseUser {
  passwordHash: string;
}

const PBKDF2_ALGO = 'sha256';
const PBKDF2_ITERATIONS = 120_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_PREFIX = `pbkdf2$${PBKDF2_ALGO}$`;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function parsePbkdf2Hash(stored: string) {
  const parts = stored.split('$');
  if (parts.length !== 5) return null;
  const [, algo, iterationsRaw, salt, hash] = parts;
  const iterations = Number(iterationsRaw);
  if (!algo || !Number.isFinite(iterations) || !salt || !hash) return null;
  return { algo, iterations, salt, hash };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_ALGO).toString('hex');
  return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  if (stored.startsWith(PBKDF2_PREFIX)) {
    const parsed = parsePbkdf2Hash(stored);
    if (!parsed) return false;
    const computed = pbkdf2Sync(password, parsed.salt, parsed.iterations, PBKDF2_KEYLEN, parsed.algo).toString('hex');
    return timingSafeEqualString(computed, parsed.hash);
  }
  const isLegacySha = /^[a-f0-9]{64}$/i.test(stored);
  if (isLegacySha) {
    return timingSafeEqualString(sha256(password), stored);
  }
  const allowPlaintext =
    process.env.ALLOW_PLAINTEXT_PASSWORDS?.toLowerCase() === 'true' ||
    process.env.NODE_ENV !== 'production';
  if (allowPlaintext) {
    return timingSafeEqualString(password, stored);
  }
  return false;
}

export function needsRehash(stored: string | null): boolean {
  if (!stored) return false;
  return !stored.startsWith(PBKDF2_PREFIX);
}

export async function findEmployeeByUsername(
  username: string,
  tenantId?: string | null
): Promise<AuthenticatedUser | null> {
  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: {
      username: { equals: username.trim(), mode: 'insensitive' },
      ...(tenantId ? { tenantId } : {}),
    },
    select: {
      id: true,
      username: true,
      password: true,
      Rolle: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password,
    roleId: row.Rolle,
    accountType: 'employee',
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    employeeId: row.id,
  };
}

export async function findAdminByUsername(
  username: string,
  tenantId?: string | null
): Promise<AuthenticatedUser | null> {
  const prisma = getPrisma();
  const row = await prisma.admin.findFirst({
    where: {
      username: { equals: username.trim(), mode: 'insensitive' },
      ...(tenantId ? { tenantId } : {}),
    },
    select: { id: true, username: true, password: true },
  });
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password,
    roleId: 2,
    accountType: 'admin',
    email: null,
  };
}

export async function authenticateUser(
  username: string,
  password: string,
  tenantId?: string | null
): Promise<BaseUser | null> {
  const candidate =
    (await findEmployeeByUsername(username, tenantId)) ??
    (await findAdminByUsername(username, tenantId));
  if (!candidate) {
    return null;
  }

  if (!verifyPassword(password, candidate.passwordHash)) {
    return null;
  }

  const { passwordHash, ...user } = candidate;
  void passwordHash;
  return user;
}

export async function findUserProfileByUsername(
  username: string,
  tenantId?: string | null
): Promise<BaseUser | null> {
  const candidate =
    (await findEmployeeByUsername(username, tenantId)) ??
    (await findAdminByUsername(username, tenantId));
  if (!candidate) {
    return null;
  }

  const { passwordHash, ...user } = candidate;
  void passwordHash;

  return {
    ...user,
    email: user.email ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    employeeId: user.employeeId ?? null,
  };
}
