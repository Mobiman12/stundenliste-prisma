import { getPrisma } from '@/lib/prisma';

export type FooterPreferences = Record<string, boolean>;

export async function getFooterPreferences(employeeId: number): Promise<FooterPreferences | null> {
  const prisma = getPrisma();
  const row = await prisma.footerViewSettings.findUnique({
    where: { userId: employeeId },
    select: { groupStates: true },
  });

  if (!row?.groupStates) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.groupStates) as FooterPreferences;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveFooterPreferences(
  employeeId: number,
  preferences: FooterPreferences
): Promise<void> {
  const prisma = getPrisma();
  const payload = JSON.stringify(preferences ?? {});

  await prisma.footerViewSettings.upsert({
    where: { userId: employeeId },
    update: { groupStates: payload },
    create: { userId: employeeId, groupStates: payload },
  });
}
