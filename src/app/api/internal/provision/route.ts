import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

type Mode = "EMPTY" | "MINIMAL" | "DEMO";

function assertSecret(headers: Headers) {
  const secret = process.env.PROVISION_SECRET?.trim();
  const incoming = headers.get("x-provision-secret");
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  return Boolean(incoming && incoming === secret);
}

function getMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function POST(req: Request) {
  if (!assertSecret(req.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    console.info("[provision] received", body);
    const mode = (body?.mode as Mode) || "MINIMAL";

    const prisma = getPrisma();
    const isDemo = mode === "DEMO";
    const today = new Date().toISOString().slice(0, 10);

    // Demo-Branch
    const demoBranchData = {
      name: "Demo Standort",
      slug: "demo",
      city: "Berlin",
      country: "DE",
      timezone: "Europe/Berlin",
      addressLine1: "Musterstrasse 12",
      addressLine2: "2. Etage",
      postalCode: "10115",
      phone: "+49 30 123456",
      email: "standort@demo.local",
      street: "Musterstrasse 12",
      openingHours: "Mo-Fr 08:00-16:00",
      metadata: JSON.stringify({ federalState: "DE-BE" }),
    };
    const minimalBranchData = {
      name: "Demo Standort",
      slug: "demo",
      city: "Berlin",
      country: "DE",
      timezone: "Europe/Berlin",
    };
    const branch = await prisma.branch.upsert({
      where: { slug: "demo" },
      update: isDemo ? demoBranchData : {},
      create: isDemo ? demoBranchData : minimalBranchData,
    });

    // Demo-Branch-Schedule Mo-Fr 08:00-16:00
    await prisma.branchSchedule.deleteMany({ where: { branchId: branch.id } });
    const weekdays = [1, 2, 3, 4, 5];
    await prisma.branchSchedule.createMany({
      data: weekdays.map((weekday) => ({
        branchId: branch.id,
        weekday,
        segmentIndex: 0,
        startsAtMinutes: 8 * 60,
        endsAtMinutes: 16 * 60,
        isActive: 1,
      })),
    });

    // Demo-Mitarbeiter
    const baseEmployeeData = {
      firstName: "Demo",
      lastName: "Mitarbeiter",
      entryDate: today,
      personnelNumber: "demo-1",
      username: "demo",
      password: hashPassword("demo1234"),
      Rolle: 2,
      bookingPin: "0000",
      showInCalendar: 1,
      isActive: 1,
    };
    const demoEmployeeDetails = {
      street: "Musterstrasse 12",
      zipCode: "10115",
      city: "Berlin",
      birthDate: "1990-01-15",
      phone: "+49 30 1234567",
      email: "demo.mitarbeiter@demo.local",
      arbeitsstundenProWoche: 38.5,
      taxClass: "I",
      hourlyWage: 18.5,
      vacationDays: 28,
      vacationDaysLastYear: 2,
      allowMinusHours: "Ja",
      overtimeBalance: 5,
      sachbezuege: "Nein",
      sachbezuegeAmount: 0,
      mindJahresumsatz: 0,
      sachbezugVerpflegung: "Nein",
      maxUeberstunden: 20,
      maxMinusstunden: 10,
      yearlySollHours: 1600,
      importedOvertimeBalance: 2,
      importedMinusstundenBalance: 1,
      importedVacationTaken: 3,
      importedBonusEarned: 200,
      importedPlusOvertime: 5,
      importedMinusOvertime: 0,
      monatlicherBonusProzent: 5,
      tillhubUserId: "demo-user",
      tillhubAccountId: "demo-account",
      minPauseUnder6Minutes: 15,
      federalState: "DE-BE",
      mandatoryPauseEnabled: 1,
      vacationDaysTotal: 28,
      kinderfreibetrag: 0.5,
      iban: "DE89370400440532013000",
      bic: "COBADEFFXXX",
      steuerId: "12/345/67890",
      socialSecurityNumber: "65 120190 M 012",
      healthInsurance: "TK",
      nationality: "DE",
      maritalStatus: "ledig",
      healthInsuranceNumber: "A123456789",
      employmentType: "Vollzeit",
      workTimeModel: "Gleitzeit",
      probationMonths: 6,
      tarifGroup: "TG1",
      emergencyContactName: "Erika Muster",
      emergencyContactPhone: "+49 170 1234567",
      emergencyContactRelation: "Partner/in",
    };
    const demoEmployee = await prisma.employee.upsert({
      where: { personnelNumber: "demo-1" },
      update: isDemo
        ? { ...baseEmployeeData, ...demoEmployeeDetails }
        : {
            firstName: "Demo",
            lastName: "Mitarbeiter",
            showInCalendar: 1,
            bookingPin: "0000",
            Rolle: 2,
            isActive: 1,
          },
      create: isDemo ? { ...baseEmployeeData, ...demoEmployeeDetails } : baseEmployeeData,
    });

    await prisma.employeeBranch.createMany({
      data: [{ employeeId: demoEmployee.id, branchId: branch.id }],
      skipDuplicates: true,
    });

    // Demo-ShiftPlan (einfacher Wochenplan Mo-Fr 08-16)
    const existingPlan = await prisma.shiftPlan.findFirst({ where: { employeeId: demoEmployee.id } });
    if (existingPlan) {
      await prisma.shiftPlan.update({
        where: { id: existingPlan.id },
        data: {
          W1_mon_start: "08:00",
          W1_mon_end: "16:00",
          W1_tue_start: "08:00",
          W1_tue_end: "16:00",
          W1_wed_start: "08:00",
          W1_wed_end: "16:00",
          W1_thu_start: "08:00",
          W1_thu_end: "16:00",
          W1_fri_start: "08:00",
          W1_fri_end: "16:00",
        },
      });
    } else {
      await prisma.shiftPlan.create({
        data: {
          employeeId: demoEmployee.id,
          twoWeekCycle: "no",
          W1_mon_start: "08:00",
          W1_mon_end: "16:00",
          W1_tue_start: "08:00",
          W1_tue_end: "16:00",
          W1_wed_start: "08:00",
          W1_wed_end: "16:00",
          W1_thu_start: "08:00",
          W1_thu_end: "16:00",
          W1_fri_start: "08:00",
          W1_fri_end: "16:00",
        },
      });
    }

    // Demo-ShiftPlanDays für aktuelle Woche (Mo-Fr)
    const monday = getMonday();
    await prisma.shiftPlanDay.deleteMany({ where: { employeeId: demoEmployee.id } });
    const daysData = weekdays.map((offset, idx) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + (idx));
      return {
        employeeId: demoEmployee.id,
        dayDate: d.toISOString().slice(0, 10),
        startTime: "08:00",
        endTime: "16:00",
        requiredPauseMinutes: 30,
        label: "Demo Schicht",
        branchId: branch.id,
      };
    });
    await prisma.shiftPlanDay.createMany({ data: daysData });

    return NextResponse.json({ ok: true, branchId: branch.id, employeeId: demoEmployee.id });
  } catch (error) {
    console.error("[provision] failed", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
