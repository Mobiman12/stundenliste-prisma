import { NextRequest, NextResponse } from "next/server";

import { getServerAuthSession } from "@/lib/auth/session";

function getClientIp(req: NextRequest): string | null {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }
  const realIp = req.headers.get("x-real-ip");
  return realIp?.trim() || null;
}

export async function GET(req: NextRequest) {
  const debugAdmins = process.env.DEBUG_OVERLAY_ADMINS?.trim().toLowerCase() === "true";
  const debugIps =
    process.env.DEBUG_OVERLAY_IPS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const session = await getServerAuthSession();
  const isAdmin =
    session?.user?.roleId === 2 ||
    session?.user?.accountType === "admin";
  const ip = getClientIp(req);
  const allowByIp = ip ? debugIps.includes(ip) : false;
  const allowed = Boolean((isAdmin && debugAdmins) || allowByIp);
  const diagnostics = req.nextUrl.searchParams.get("debug") === "1";
  if (diagnostics) {
    return NextResponse.json({
      allowed,
      debugAdmins,
      allowByIp,
      ip,
      sessionUser: session?.user ?? null,
      tenantId: session?.tenantId ?? null,
    });
  }
  return NextResponse.json({ allowed });
}
