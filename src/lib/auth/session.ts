import { cookies } from 'next/headers';

import { findUserProfileByUsername, type BaseUser } from '@/lib/auth';
import { SESSION_COOKIE, verifyTeamSession, type TeamSessionPayload } from '@/lib/team-session';

export interface AuthSession {
  user: BaseUser;
  expiresAt: number;
  raw: TeamSessionPayload;
  tenantId?: string | null;
}

export async function getServerAuthSession(): Promise<AuthSession | null> {
  try {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(SESSION_COOKIE)?.value ?? null;
    const session = await verifyTeamSession(cookieValue);
    if (!session) {
      return null;
    }
    const tenantId = typeof session.tenantId === 'string' ? session.tenantId.trim() : '';
    if (!tenantId) {
      return null;
    }

    const user = await findUserProfileByUsername(session.username, tenantId);
    if (!user) {
      return null;
    }

    return {
      user,
      expiresAt: session.expiresAt,
      raw: session,
      tenantId,
    };
  } catch (error) {
    console.warn('[stundenliste] getServerAuthSession failed', error);
    return null;
  }
}
