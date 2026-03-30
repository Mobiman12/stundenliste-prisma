import { NextRequest, NextResponse } from "next/server";

import { getServerAuthSession } from "@/lib/auth/session";
import { SESSION_COOKIE, verifyTeamSession } from "@/lib/team-session";

function getClientIp(req: NextRequest): string | null {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }
  const realIp = req.headers.get("x-real-ip");
  return realIp?.trim() || null;
}

function isAllowed(
  session: Awaited<ReturnType<typeof getServerAuthSession>>,
  ip: string | null,
) {
  const debugAdmins = process.env.DEBUG_OVERLAY_ADMINS?.trim().toLowerCase() === "true";
  const debugIps =
    process.env.DEBUG_OVERLAY_IPS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const isAdmin =
    session?.user?.roleId === 2 ||
    session?.user?.accountType === "admin";
  const allowByIp = ip ? debugIps.includes(ip) : false;
  return {
    allowed: Boolean((isAdmin && debugAdmins) || allowByIp),
    debugAdmins,
    allowByIp,
  };
}

export async function GET(req: NextRequest) {
  const session = await getServerAuthSession();
  const ip = getClientIp(req);
  const { allowed, debugAdmins, allowByIp } = isAllowed(session, ip);
  if (!allowed) {
    return NextResponse.json({ allowed: false }, { status: 403 });
  }

  const cookieValue = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  const decoded = cookieValue ? await verifyTeamSession(cookieValue) : null;

  return NextResponse.json({
    allowed: true,
    debugAdmins,
    allowByIp,
    ip,
    host: req.headers.get("host"),
    referer: req.headers.get("referer"),
    userAgent: req.headers.get("user-agent"),
    cookiePresent: Boolean(cookieValue),
    cookieLength: cookieValue ? cookieValue.length : 0,
    sessionFromServer: session ?? null,
    sessionFromCookie: decoded ?? null,
  });
}
