import { getPrisma } from '@/lib/prisma';

export async function getAdminDocumentLastSeen(tenantId: string, adminId: number): Promise<number> {
  const prisma = getPrisma();
  const row = await prisma.adminDocumentSeen.findFirst({
    where: { adminId, tenantId },
    select: { lastSeen: true },
  });
  return typeof row?.lastSeen === 'number' ? row.lastSeen : 0;
}

export async function updateAdminDocumentLastSeen(
  tenantId: string,
  adminId: number,
  lastSeen: number
): Promise<void> {
  if (!Number.isFinite(lastSeen) || lastSeen <= 0) return;
  const prisma = getPrisma();
  await prisma.adminDocumentSeen.upsert({
    where: { adminId },
    update: { lastSeen, tenantId },
    create: { adminId, tenantId, lastSeen },
  });
}

export async function markAdminDocumentsSeen(
  tenantId: string,
  adminId: number,
  lastSeen: number
): Promise<void> {
  if (!Number.isFinite(lastSeen) || lastSeen <= 0) return;
  const current = await getAdminDocumentLastSeen(tenantId, adminId);
  if (lastSeen <= current) return;
  await updateAdminDocumentLastSeen(tenantId, adminId, lastSeen);
}
