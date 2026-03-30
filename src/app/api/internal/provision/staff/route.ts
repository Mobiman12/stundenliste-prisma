import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { hashPassword } from "@/lib/auth";
import { toLocalIsoDate } from "@/lib/date/local-iso";
import { getPrisma } from "@/lib/prisma";

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeEmail(value: unknown): string | null {
  const email = normalizeString(value);
  if (!email) return null;
  // Keep it minimal: Timesheet stores email as plain string, but comparisons should be case-insensitive.
  return email.toLowerCase();
}

function normalizePersonnelNumber(value: unknown): string | null {
  const raw = normalizeString(value);
  if (!raw) return null;
  // Personnel numbers in Timesheet are usually numeric; we accept text but enforce a safe length.
  const trimmed = raw.slice(0, 64);
  return trimmed.length ? trimmed : null;
}

function isNumericPersonnelNumber(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^\d{1,16}$/.test(value.trim());
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
  houseNumber?: string | null;
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

function resolveLifecycleIsActive(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return true;
  }
  const lifecycle = metadata.lifecycle;
  if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)) {
    return true;
  }
  const isActive = (lifecycle as Record<string, unknown>).isActive;
  return typeof isActive === "boolean" ? isActive : true;
}

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
  const today = toLocalIsoDate();
  const incomingStaffIds = new Set(staff.map((person) => person.id).filter(Boolean));

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // When we create new employees (no legacy record to attach to), we want a human personnel number.
    // We default to the next free numeric personnelNumber, but allow provisioning to provide one via metadata.
    const numericPersonnelNumbers = await tx.employee
      .findMany({
        where: { tenantId },
        select: { personnelNumber: true },
      })
      .then((rows) =>
        rows
          .map((row) => (typeof row.personnelNumber === "string" ? row.personnelNumber.trim() : ""))
          .filter((value) => isNumericPersonnelNumber(value))
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isFinite(value)),
      );
    let nextPersonnelNumber = numericPersonnelNumbers.length
      ? Math.max(...numericPersonnelNumbers) + 1
      : 1;

    for (const person of staff) {
      if (!person?.id) continue;
      const staffId = person.id.trim();
      const incomingEmail = normalizeEmail(person.email);
      const incomingRole = person.role ? Number(person.role) || 1 : 1;

      const displayName =
        person.displayName ||
        [person.firstName, person.lastName].filter(Boolean).join(" ").trim() ||
        "Unbenannt";

      // Resolve the canonical employee row.
      // Priority:
      // 1) Already mapped by controlPlaneStaffId
      // 2) Legacy record match by email (same person), keep legacy personnelNumber untouched
      // 3) Existing row where personnelNumber == staffId (old buggy provisioning), treated as duplicate
      const existingByStaffId = await tx.employee.findFirst({
        where: { tenantId, controlPlaneStaffId: staffId },
      });

      const existingByEmail = incomingEmail
        ? await tx.employee.findFirst({
            where: { tenantId, email: { equals: incomingEmail, mode: "insensitive" } },
            orderBy: { createdAt: "asc" },
          })
        : null;

      const existingByPersonnelNumber = await tx.employee.findFirst({
        where: { tenantId, personnelNumber: staffId },
      });

      // Pick canonical:
      // - Prefer a legacy-by-email record if present, because it contains the real personnel number.
      // - Otherwise use the mapped controlPlaneStaffId record.
      // - Otherwise fall back to the staffId-personnelNumber record (which might exist from earlier runs).
      const canonical = existingByEmail ?? existingByStaffId ?? existingByPersonnelNumber ?? null;

      const bookingPin =
        person.bookingPin ??
        canonical?.bookingPin ??
        Math.floor(1000 + Math.random() * 9000)
          .toString()
          .slice(0, 4);

      // Email is the username for all logins.
      // We must keep username unique per tenant, but also avoid failing provisioning when legacy rows conflict.
      const desiredUsername = (incomingEmail ?? normalizeEmail(person.username) ?? canonical?.username ?? `staff_${staffId}`)
        .toLowerCase()
        .trim();

      const freeUsernameIfTaken = async (candidate: string, canonicalId: number | null) => {
        const existing = await tx.employee.findUnique({
          where: { tenantId_username: { tenantId, username: candidate } },
          select: { id: true, controlPlaneStaffId: true, personnelNumber: true },
        });
        if (!existing) return;
        if (canonicalId && existing.id === canonicalId) return;

        const suffix =
          (typeof existing.controlPlaneStaffId === "string" && existing.controlPlaneStaffId.trim()) ||
          (typeof existing.personnelNumber === "string" && existing.personnelNumber.trim()) ||
          String(existing.id);
        let newUsername = `legacy_${suffix}`;
        // Ensure the new username is unique.
        const conflict = await tx.employee.findUnique({
          where: { tenantId_username: { tenantId, username: newUsername } },
          select: { id: true },
        });
        if (conflict) {
          newUsername = `legacy_${suffix}_${Date.now()}`;
        }
        await tx.employee.update({
          where: { id: existing.id },
          data: { username: newUsername, isActive: 0, showInCalendar: 0 },
          select: { id: true },
        });
      };

      const canonicalId = canonical ? canonical.id : null;
      await freeUsernameIfTaken(desiredUsername, canonicalId);
      const username = desiredUsername;

      const fallbackPassword = person.passwordHash ?? canonical?.password ?? "changeme";
      const passwordHash =
        typeof fallbackPassword === "string" &&
        (fallbackPassword.startsWith("pbkdf2$") || /^[a-f0-9]{64}$/i.test(fallbackPassword))
          ? fallbackPassword
          : hashPassword(String(fallbackPassword));
      const tillhubUserId = normalizeString(person.tillhubUserId) ?? canonical?.tillhubUserId ?? null;

      const showInCalendar = person.showInCalendar ?? true;
      const lifecycleIsActive = resolveLifecycleIsActive(person.metadata ?? null);
      const canonicalOnboardingStatus = normalizeString(canonical?.onboardingStatus);
      const onboardingStatus =
        canonicalOnboardingStatus?.toLowerCase() === "pending"
          ? "pending"
          : canonicalOnboardingStatus?.toLowerCase() === "deleted"
            ? "active"
            : canonicalOnboardingStatus ?? "active";

      // Preserve the existing (legacy) personnelNumber when present.
      // For brand-new employees, we prefer a provided personnelNumber (metadata.personnelNumber),
      // otherwise assign the next free numeric personnelNumber.
      const providedPersonnelNumber = normalizePersonnelNumber(person.metadata?.personnelNumber);
      const personnelNumber =
        canonical?.personnelNumber ??
        providedPersonnelNumber ??
        (() => {
          const candidate = String(nextPersonnelNumber);
          nextPersonnelNumber += 1;
          return candidate;
        })();

      const effectiveRole = canonical?.Rolle ? Math.max(Number(canonical.Rolle) || 1, incomingRole) : incomingRole;

      const payload = {
        tenantId,
        controlPlaneStaffId: staffId,
        firstName: person.firstName ?? displayName,
        lastName: person.lastName ?? "",
        email: incomingEmail ?? person.email ?? null,
        phone: person.phone ?? null,
        street: person.street ?? canonical?.street ?? null,
        houseNumber: person.houseNumber ?? canonical?.houseNumber ?? null,
        zipCode: person.zipCode ?? canonical?.zipCode ?? null,
        city: person.city ?? canonical?.city ?? null,
        birthDate: person.birthDate ?? canonical?.birthDate ?? null,
        federalState: person.federalState ?? canonical?.federalState ?? null,
        tillhubUserId,
        entryDate: canonical?.entryDate ?? today,
        personnelNumber,
        username,
        password: passwordHash,
        Rolle: effectiveRole,
        bookingPin,
        showInCalendar: showInCalendar ? 1 : 0,
        isActive: lifecycleIsActive ? 1 : 0,
        onboardingStatus,
      };

      // Apply update/create against canonical row.
      const savedEmployee = canonical
        ? await tx.employee.update({
            where: { id: canonical.id },
            data: payload,
            select: { id: true, email: true },
          })
        : await tx.employee.create({
            data: {
              ...payload,
              birthDate: payload.birthDate ?? null,
              street: payload.street ?? null,
              houseNumber: payload.houseNumber ?? null,
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
              isActive: lifecycleIsActive ? 1 : 0,
              onboardingStatus: payload.onboardingStatus,
            },
            select: { id: true, email: true },
          });

      // If we have other duplicate rows for the same email, deactivate/hide them.
      if (incomingEmail) {
        await tx.employee.updateMany({
          where: {
            tenantId,
            email: { equals: incomingEmail, mode: "insensitive" },
            id: { not: savedEmployee.id },
          },
          data: { isActive: 0, showInCalendar: 0 },
        });
      }

      if (Array.isArray(person.branchIds)) {
        const branchIds = Array.from(
          new Set(
            person.branchIds
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0),
          ),
        );
        if (savedEmployee) {
          await tx.employeeBranch.deleteMany({ where: { employeeId: savedEmployee.id } });
          if (branchIds.length) {
            await tx.employeeBranch.createMany({
              data: branchIds.map((branchId) => ({ employeeId: savedEmployee.id, branchId })),
              skipDuplicates: true,
            });
          }
        }
      }
    }

    if (replace) {
      const ids = Array.from(incomingStaffIds);
      await tx.employee.updateMany({
        where: {
          tenantId,
          controlPlaneStaffId: {
            not: null,
            ...(ids.length ? { notIn: ids } : {}),
          },
        },
        data: { isActive: 0, showInCalendar: 0, onboardingStatus: "deleted" },
      });
    }
  });

  return NextResponse.json({ ok: true, count: staff.length });
}
