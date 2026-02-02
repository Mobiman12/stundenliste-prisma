import { NextResponse } from "next/server";

import { getPrisma } from "@/lib/prisma";
import { createBranch, deleteBranch, updateBranch } from "@/lib/data/branches";

function assertSecret(headers: Headers) {
  const secret = process.env.PROVISION_SECRET;
  const incoming = headers.get("x-provision-secret");
  return Boolean(secret && incoming && incoming === secret);
}

type IncomingBranch = {
  slug?: string | null;
  name?: string | null;
  timezone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  federalState?: string | null;
  phone?: string | null;
  email?: string | null;
};

type BranchResult = {
  slug: string;
  id: number;
};

export async function POST(req: Request) {
  if (!assertSecret(req.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
  const replace = body?.replace === true;
  const rawBranches = Array.isArray(body?.branches) ? (body.branches as IncomingBranch[]) : [];

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  if (!rawBranches.length && !replace) {
    return NextResponse.json({ error: "branches required" }, { status: 400 });
  }

  const errors: string[] = [];
  const branches = rawBranches.map((branch, index) => {
    const slug = typeof branch?.slug === "string" ? branch.slug.trim() : "";
    const name = typeof branch?.name === "string" ? branch.name.trim() : "";
    if (!slug) errors.push(`branches[${index}].slug fehlt`);
    if (!name) errors.push(`branches[${index}].name fehlt`);
    return {
      slug,
      name,
      timezone: branch?.timezone ?? null,
      addressLine1: branch?.addressLine1 ?? null,
      addressLine2: branch?.addressLine2 ?? null,
      postalCode: branch?.postalCode ?? null,
      city: branch?.city ?? null,
      country: branch?.country ?? null,
      federalState: branch?.federalState ?? null,
      phone: branch?.phone ?? null,
      email: branch?.email ?? null,
    };
  });

  if (errors.length) {
    return NextResponse.json({ error: errors.join(", ") }, { status: 400 });
  }

  const prisma = getPrisma();
  const existing = await prisma.branch.findMany({
    where: { tenantId },
    select: { id: true, slug: true, name: true },
  });
  const existingBySlug = new Map<string, number>();
  const existingByName = new Map<string, number>();
  for (const row of existing) {
    if (typeof row.slug === "string" && row.slug.trim()) {
      existingBySlug.set(row.slug.trim(), row.id);
    }
    if (typeof row.name === "string" && row.name.trim()) {
      existingByName.set(row.name.trim().toLowerCase(), row.id);
    }
  }

  const results: BranchResult[] = [];
  const seenSlugs = new Set<string>();
  const seenIds = new Set<number>();

  for (const branch of branches) {
    if (!branch.slug || !branch.name) continue;
    if (seenSlugs.has(branch.slug)) continue;
    seenSlugs.add(branch.slug);

    const input = {
      name: branch.name,
      slug: branch.slug,
      timezone: branch.timezone,
      addressLine1: branch.addressLine1,
      addressLine2: branch.addressLine2,
      postalCode: branch.postalCode,
      city: branch.city,
      country: branch.country,
      federalState: branch.federalState,
      phone: branch.phone,
      email: branch.email,
    };

    const nameKey = branch.name.trim().toLowerCase();
    const existingId = existingBySlug.get(branch.slug) ?? existingByName.get(nameKey);
    if (existingId) {
      await updateBranch(tenantId, existingId, input);
      results.push({ slug: branch.slug, id: existingId });
      seenIds.add(existingId);
    } else {
      const createdId = await createBranch(tenantId, input);
      results.push({ slug: branch.slug, id: createdId });
      seenIds.add(createdId);
    }
  }

  if (replace) {
    const toRemove = existing.filter((row) => !seenIds.has(row.id));
    for (const row of toRemove) {
      await deleteBranch(tenantId, row.id);
    }
  }

  return NextResponse.json({ ok: true, branches: results });
}
