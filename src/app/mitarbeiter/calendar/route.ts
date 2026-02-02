import { NextRequest, NextResponse } from "next/server";

import { getServerAuthSession } from "@/lib/auth/session";
import { getPrisma } from "@/lib/prisma";
import { withAppBasePath } from "@/lib/routes";
import { createTenantSsoToken } from "@/lib/tenant-sso";

const CALENDAR_BASE_URL =
  (process.env.NEXT_PUBLIC_CALENDAR_URL ?? process.env.CALENDAR_APP_URL ?? "http://localhost:3002").trim() ||
  "http://localhost:3002";

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export async function GET(request: NextRequest) {
  const session = await getServerAuthSession();
  if (!session) {
    const loginUrl = new URL(withAppBasePath("/login", "external"), request.url);
    loginUrl.searchParams.set("mode", "employee");
    loginUrl.searchParams.set("redirect", withAppBasePath("/mitarbeiter/calendar", "external"));
    return NextResponse.redirect(loginUrl);
  }

  const tenantId = session.tenantId ?? null;
  const employeeId = session.user.employeeId ?? null;
  if (!tenantId || !employeeId) {
    return NextResponse.redirect(new URL(withAppBasePath("/mitarbeiter", "external"), request.url));
  }

  const prisma = getPrisma();
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      personnelNumber: true,
      email: true,
      firstName: true,
      lastName: true,
      Rolle: true,
    },
  });

  const staffCode = normalizeString(employee?.personnelNumber);
  if (!staffCode) {
    return NextResponse.redirect(new URL(withAppBasePath("/mitarbeiter", "external"), request.url));
  }

  let locationSlug: string | null = null;
  const branchRow = await prisma.employeeBranch.findFirst({
    where: { employeeId, branch: { tenantId } },
    select: { branch: { select: { slug: true, name: true } } },
    orderBy: { branch: { name: "asc" } },
  });
  locationSlug = normalizeString(branchRow?.branch.slug);
  if (!locationSlug) {
    const fallback = await prisma.branch.findFirst({
      where: { tenantId },
      select: { slug: true },
      orderBy: { name: "asc" },
    });
    locationSlug = normalizeString(fallback?.slug);
  }

  const redirectPath = locationSlug ? `/backoffice/${locationSlug}/calendar` : "/backoffice";
  const tenantSlug =
    normalizeString(session.raw.tenantSlug) ??
    normalizeString(session.raw.tenantName) ??
    normalizeString(session.tenantId) ??
    "tenant";
  const tenantName = normalizeString(session.raw.tenantName);
  const displayName = [employee?.firstName, employee?.lastName].filter(Boolean).join(" ").trim();

  const token = createTenantSsoToken({
    tenantId,
    tenantSlug,
    tenantName,
    email: normalizeString(employee?.email) ?? normalizeString(session.raw.email),
    app: "CALENDAR",
    username: displayName || session.user.username,
    firstName: normalizeString(employee?.firstName),
    lastName: normalizeString(employee?.lastName),
    displayName: displayName || null,
    returnTo: redirectPath,
    staffCode,
    role: Number.isFinite(employee?.Rolle) ? String(employee?.Rolle) : null,
  });

  const target = new URL("/auth/staff-sso", CALENDAR_BASE_URL);
  target.searchParams.set("token", token);
  target.searchParams.set("redirect", redirectPath);
  return NextResponse.redirect(target);
}
