import { NextRequest, NextResponse } from "next/server";

import { getPrisma } from "@/lib/prisma";

function assertSecret(headers: Headers) {
  const secret = process.env.PROVISION_SECRET;
  const incoming = headers.get("x-provision-secret");
  return Boolean(secret && incoming && incoming === secret);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve a Control Plane staff id to the corresponding Timesheet employee id.
 *
 * This is used by the Control Plane UI to generate a deep-link into:
 *   /admin/mitarbeitende/:employeeId?tab=management
 *
 * IMPORTANT:
 * - Protected by x-provision-secret (same as provisioning routes).
 * - No external calls.
 */
export async function GET(request: NextRequest) {
  if (!assertSecret(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = readString(request.nextUrl.searchParams.get("tenantId"));
  const staffId = readString(request.nextUrl.searchParams.get("staffId"));
  if (!tenantId || !staffId) {
    return NextResponse.json({ error: "tenantId and staffId required" }, { status: 400 });
  }

  const prisma = getPrisma();
  const row = await prisma.employee.findFirst({
    where: { tenantId, controlPlaneStaffId: staffId },
    select: { id: true, username: true, isActive: true },
  });

  return NextResponse.json({
    ok: true,
    employeeId: row?.id ?? null,
    username: row?.username ?? null,
    isActive: typeof row?.isActive === "number" ? row.isActive === 1 : null,
  });
}
