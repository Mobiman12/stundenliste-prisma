import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { getPrismaClient } from "@/lib/prisma";
import { supportsCustomerMemberships } from "@/lib/customer-memberships";

const prisma = getPrismaClient();

const CUSTOMER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  categoryId: true,
  createdAt: true,
} satisfies Prisma.CustomerSelect;

async function resolveLocation(locationSlug: string) {
  return prisma.location.findUnique({
    where: { slug: locationSlug },
    select: { id: true, slug: true, name: true },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ location: string; customerId: string }> },
) {
  const { location, customerId } = await context.params;

  const locationRecord = await resolveLocation(location);
  if (!locationRecord) {
    return NextResponse.json({ error: "Standort nicht gefunden." }, { status: 404 });
  }

  const membershipSupported = await supportsCustomerMemberships(prisma);
  const scope: Prisma.CustomerWhereInput = membershipSupported
    ? {
        id: customerId,
        OR: [
          { locationId: locationRecord.id },
          { memberships: { some: { locationId: locationRecord.id } } },
        ],
      }
    : {
        id: customerId,
        locationId: locationRecord.id,
      };

  const customer = await prisma.customer.findFirst({
    where: scope,
    select: CUSTOMER_SELECT,
  });

  if (!customer) {
    return NextResponse.json({ error: "Kunde wurde nicht gefunden." }, { status: 404 });
  }

  const appointmentCount = await prisma.appointment.count({
    where: { customerId: customer.id, locationId: locationRecord.id },
  });

  const categories = await prisma.customerCategory.findMany({
    where: { locationId: locationRecord.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true },
  });

  return NextResponse.json({
    customer: {
      ...customer,
      appointmentCount,
    },
    categories,
    location: {
      id: locationRecord.id,
      slug: locationRecord.slug,
      name: locationRecord.name,
    },
  });
}

type UpdatePayload = {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  categoryId?: string | null;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ location: string; customerId: string }> },
) {
  const { location, customerId } = await context.params;
  const locationRecord = await resolveLocation(location);
  if (!locationRecord) {
    return NextResponse.json({ error: "Standort nicht gefunden." }, { status: 404 });
  }

  const membershipSupported = await supportsCustomerMemberships(prisma);
  const scope: Prisma.CustomerWhereInput = membershipSupported
    ? {
        id: customerId,
        OR: [
          { locationId: locationRecord.id },
          { memberships: { some: { locationId: locationRecord.id } } },
        ],
      }
    : {
        id: customerId,
        locationId: locationRecord.id,
      };

  const customer = await prisma.customer.findFirst({
    where: scope,
    select: CUSTOMER_SELECT,
  });

  if (!customer) {
    return NextResponse.json({ error: "Kunde wurde nicht gefunden." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as UpdatePayload | null;
  if (!body) {
    return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
  }

  const firstName = String(body.firstName ?? customer.firstName ?? "").trim();
  const lastName = String(body.lastName ?? customer.lastName ?? "").trim();
  if (!firstName) {
    return NextResponse.json({ error: "Vorname ist erforderlich." }, { status: 400 });
  }
  if (!lastName) {
    return NextResponse.json({ error: "Nachname ist erforderlich." }, { status: 400 });
  }

  const emailRaw = typeof body.email === "string" ? body.email.trim() : customer.email ?? "";
  const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : customer.phone ?? "";
  const categoryIdRaw = typeof body.categoryId === "string" ? body.categoryId.trim() : customer.categoryId ?? "";

  const email = emailRaw.length ? emailRaw : null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Ungültige E-Mail-Adresse." }, { status: 400 });
  }

  const phone = phoneRaw.length ? phoneRaw : null;

  let categoryId: string | null = null;
  if (categoryIdRaw.length) {
    const category = await prisma.customerCategory.findFirst({
      where: { id: categoryIdRaw, locationId: locationRecord.id },
      select: { id: true },
    });
    if (!category) {
      return NextResponse.json({ error: "Kategorie wurde nicht gefunden." }, { status: 400 });
    }
    categoryId = category.id;
  }

  try {
    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        firstName,
        lastName,
        email,
        phone,
        categoryId,
      },
      select: CUSTOMER_SELECT,
    });

    revalidatePath(`/backoffice/${locationRecord.slug}/customers`);
    revalidatePath(`/backoffice/${locationRecord.slug}/calendar`);

    return NextResponse.json({
      customer: {
        ...updated,
        appointmentCount: await prisma.appointment.count({
          where: { customerId: customer.id, locationId: locationRecord.id },
        }),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Ein Kunde mit diesen Daten existiert bereits." }, { status: 400 });
    }
    console.error("[customer:update] failed", error);
    return NextResponse.json({ error: "Kunde konnte nicht aktualisiert werden." }, { status: 500 });
  }
}
