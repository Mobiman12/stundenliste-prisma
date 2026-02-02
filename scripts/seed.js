import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password) {
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex');
}

async function main() {
  const tenantId = process.env.SEED_TENANT_ID || 'dev-tenant';
  const adminUsername = process.env.SEED_ADMIN_USER || 'Admin';
  const adminPassword = process.env.SEED_ADMIN_PASS || 'admin123';

  const employeeUsername = process.env.SEED_EMP_USER || 'employee';
  const employeePassword = process.env.SEED_EMP_PASS || 'password123';

  console.log('[seed] starting');

  const branch = await prisma.branch.upsert({
    where: { tenantId_name: { tenantId, name: 'Hauptstandort' } },
    update: {},
    create: {
      tenantId,
      name: 'Hauptstandort',
      slug: 'hauptstandort',
      city: 'Berlin',
      timezone: 'Europe/Berlin',
      country: 'DE',
    },
  });

  const admin = await prisma.admin.upsert({
    where: { tenantId_username: { tenantId, username: adminUsername } },
    update: { password: hashPassword(adminPassword) },
    create: {
      tenantId,
      username: adminUsername,
      password: hashPassword(adminPassword),
    },
  });

  const employee = await prisma.employee.upsert({
    where: { tenantId_username: { tenantId, username: employeeUsername } },
    update: { password: hashPassword(employeePassword) },
    create: {
      tenantId,
      username: employeeUsername,
      password: hashPassword(employeePassword),
      Rolle: 1,
      firstName: 'Max',
      lastName: 'Mustermann',
      entryDate: '2023-01-01',
      personnelNumber: 'E-1000',
      bookingPin: '0000',
      isActive: 1,
      showInCalendar: 1,
      vacationDays: 20,
      vacationDaysTotal: 20,
      overtimeBalance: 0,
      arbeitsstundenProWoche: 40,
    },
  });

  await prisma.employeeBranch.upsert({
    where: { employeeId_branchId: { employeeId: employee.id, branchId: branch.id } },
    update: {},
    create: { employeeId: employee.id, branchId: branch.id },
  });

  console.log('[seed] done', { admin: admin.username, employee: employee.username, branch: branch.slug });
}

main()
  .catch((error) => {
    console.error('[seed] failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
