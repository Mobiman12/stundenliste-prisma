import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function assertSecret(headers: Headers) {
  const secret = process.env.PROVISION_SECRET;
  const incoming = headers.get("x-provision-secret");
  return Boolean(secret && incoming && incoming === secret);
}

type IncomingStaff = {
  id: string;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  username?: string | null;
  street?: string | null;
  zipCode?: string | null;
  city?: string | null;
  birthDate?: string | null;
  federalState?: string | null;
  country?: string | null;
  tillhubUserId?: string | null;
  role?: string | null;
  bookingPin?: string | null;
  passwordHash?: string | null;
  showInCalendar?: boolean;
  branchIds?: number[];
  metadata?: Record<string, unknown> | null;
};

export async function POST(req: Request) {
  if (!assertSecret(req.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const staff = Array.isArray(body?.staff) ? (body.staff as IncomingStaff[]) : [];
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
  const replace = body?.replace === true;

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  if (!staff.length && !replace) {
    return NextResponse.json({ error: "staff required" }, { status: 400 });
  }

  const prisma = getPrisma();
  const today = new Date().toISOString().slice(0, 10);
  const incomingIds = new Set(staff.map((person) => person.id).filter(Boolean));

  await prisma.$transaction(async (tx) => {
    for (const person of staff) {
      if (!person?.id) continue;
      const personnelNumber = person.id;

      const displayName =
        person.displayName ||
        [person.firstName, person.lastName].filter(Boolean).join(" ").trim() ||
        "Unbenannt";

      const existing = await tx.employee.findUnique({
        where: { tenantId_personnelNumber: { tenantId, personnelNumber } },
      });

      const bookingPin =
        person.bookingPin ??
        existing?.bookingPin ??
        Math.floor(1000 + Math.random() * 9000)
          .toString()
          .slice(0, 4);
      const username = person.email ?? person.username ?? existing?.username ?? `staff_${person.id}`;
      const fallbackPassword = person.passwordHash ?? existing?.password ?? "changeme";
      const passwordHash =
        typeof fallbackPassword === "string" &&
        (fallbackPassword.startsWith("pbkdf2$") || /^[a-f0-9]{64}$/i.test(fallbackPassword))
          ? fallbackPassword
          : hashPassword(String(fallbackPassword));
      const tillhubUserId = normalizeString(person.tillhubUserId) ?? existing?.tillhubUserId ?? null;

      const showInCalendar = person.showInCalendar ?? true;
      const payload = {
        tenantId,
        firstName: person.firstName ?? displayName,
        lastName: person.lastName ?? "",
        email: person.email ?? null,
        phone: person.phone ?? null,
        street: person.street ?? existing?.street ?? null,
        zipCode: person.zipCode ?? existing?.zipCode ?? null,
        city: person.city ?? existing?.city ?? null,
        birthDate: person.birthDate ?? existing?.birthDate ?? null,
        federalState: person.federalState ?? existing?.federalState ?? null,
        tillhubUserId,
        entryDate: existing?.entryDate ?? today,
        personnelNumber,
        username,
        password: passwordHash,
        Rolle: person.role ? Number(person.role) || 1 : 1,
        bookingPin,
        showInCalendar: showInCalendar ? 1 : 0,
        isActive: 1,
      };

      await tx.employee.upsert({
        where: { tenantId_personnelNumber: { tenantId, personnelNumber } },
        update: payload,
        create: {
          ...payload,
          birthDate: payload.birthDate ?? null,
          street: payload.street ?? null,
          zipCode: payload.zipCode ?? null,
          city: payload.city ?? null,
          entryDate: payload.entryDate,
          hourlyWage: 0,
          vacationDays: 20,
          vacationDaysLastYear: 0,
          allowMinusHours: "Nein",
          overtimeBalance: 0,
          sachbezuege: "Nein",
          sachbezuegeAmount: 0,
          mindJahresumsatz: 0,
          sachbezugVerpflegung: "Nein",
          maxUeberstunden: 0,
          maxMinusstunden: 0,
          yearlySollHours: 0,
          importedOvertimeBalance: 0,
          importedMinusstundenBalance: 0,
          importedVacationTaken: 0,
          importedBonusEarned: 0,
          importedPlusOvertime: 0,
          importedMinusOvertime: 0,
          monatlicherBonusProzent: 0,
          minPauseUnder6Minutes: 0,
          federalState: payload.federalState ?? null,
          mandatoryPauseEnabled: 0,
          vacationDaysTotal: 20,
          kinderfreibetrag: 0,
          isActive: 1,
        },
      });

      if (Array.isArray(person.branchIds)) {
        const branchIds = Array.from(
          new Set(
            person.branchIds
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0),
          ),
        );
        const employeeRow = await tx.employee.findUnique({
          where: { tenantId_personnelNumber: { tenantId, personnelNumber } },
          select: { id: true },
        });
        if (employeeRow) {
          await tx.employeeBranch.deleteMany({ where: { employeeId: employeeRow.id } });
          if (branchIds.length) {
            await tx.employeeBranch.createMany({
              data: branchIds.map((branchId) => ({ employeeId: employeeRow.id, branchId })),
              skipDuplicates: true,
            });
          }
        }
      }
    }

    if (replace) {
      const ids = Array.from(incomingIds);
      await tx.employee.updateMany({
        where: {
          tenantId,
          ...(ids.length ? { personnelNumber: { notIn: ids } } : {}),
        },
        data: { isActive: 0, showInCalendar: 0 },
      });
    }
  });

  return NextResponse.json({ ok: true, count: staff.length });
}
