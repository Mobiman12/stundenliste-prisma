import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

function assertSecret(headers: Headers) {
  const secret = process.env.PROVISION_SECRET?.trim();
  const incoming = headers.get("x-provision-secret");
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  return Boolean(incoming && incoming === secret);
}

function escapeIdentifier(value: string) {
  return value.replace(/"/g, '""');
}

/**
 * Deletes all tenant-scoped data from the Timesheet database.
 *
 * Implementation: dynamically finds all public tables with a "tenantId" column
 * and issues a DELETE for each table. This keeps the purge logic robust when
 * the schema evolves (new tables) without having to maintain a long static list.
 *
 * Protected via `x-provision-secret`.
 */
export async function POST(req: Request) {
  if (!assertSecret(req.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "tenantId_missing" }, { status: 400 });
  }

  const prisma = getPrisma();

  try {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'tenantId'
    `;

    for (const row of tables) {
      const tableName = escapeIdentifier(row.table_name);
      // Parameterized value, dynamic identifier (escaped).
      await prisma.$executeRawUnsafe(
        `DELETE FROM "public"."${tableName}" WHERE "tenantId" = $1`,
        tenantId,
      );
    }

    return NextResponse.json({ ok: true, deletedTables: tables.length });
  } catch (error) {
    console.error("[internal/tenant/purge] failed", error);
    return NextResponse.json({ ok: false, error: "purge_failed" }, { status: 500 });
  }
}

