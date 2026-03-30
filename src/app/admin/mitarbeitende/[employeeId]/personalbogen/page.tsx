import Link from "next/link";
import Script from "next/script";
import { notFound, redirect } from "next/navigation";

import { getServerAuthSession } from "@/lib/auth/session";
import { withAppBasePath } from "@/lib/routes";
import { getAdminEmployeeDetails } from "@/lib/services/admin/employee";
import { listEmployeeDocuments } from "@/lib/services/documents";
import { getEmployeeOnboardingSubmissionSnapshot } from "@/lib/services/employee-onboarding";

function formatDateTime(value: Date | null) {
  if (!value) {
    return "Nicht vorhanden";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(value);
}

function formatValue(value: boolean | number | string | null | undefined) {
  if (typeof value === "boolean") {
    return value ? "Ja" : "Nein";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "Nicht angegeben";
  }
  return "Nicht angegeben";
}

async function ensureAdminSession() {
  const session = await getServerAuthSession();

  if (!session?.user) {
    redirect(withAppBasePath("/login"));
  }
  if (session.user.roleId !== 2) {
    redirect(withAppBasePath("/mitarbeiter"));
  }
  if (!session.tenantId) {
    redirect(withAppBasePath("/login"));
  }

  return session.tenantId;
}

export default async function AdminEmployeePersonalbogenPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams?: Promise<{ print?: string | string[] | undefined }>;
}) {
  const tenantId = await ensureAdminSession();
  const { employeeId: employeeIdParam } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const printParam = resolvedSearchParams.print;
  const printMode = Array.isArray(printParam) ? printParam.includes('1') : printParam === '1';
  const employeeId = Number(employeeIdParam);

  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    notFound();
  }

  const [employee, onboardingSubmission] = await Promise.all([
    getAdminEmployeeDetails(tenantId, employeeId),
    getEmployeeOnboardingSubmissionSnapshot(tenantId, employeeId),
  ]);

  if (!employee || !onboardingSubmission) {
    notFound();
  }

  const submission = onboardingSubmission.submission;
  const adminPreset = onboardingSubmission.adminPreset;
  const employeeDocuments = listEmployeeDocuments(employeeId).filter(
    (document) => document.uploadedBy === "employee"
  );
  const signatureDocument = employeeDocuments.find((document) =>
    document.originalName.toLowerCase().includes('unterschrift')
  );
  const attachmentDocuments = employeeDocuments.filter(
    (document) => document.fileName !== signatureDocument?.fileName
  );
  const signatureImageUrl = signatureDocument
    ? `/api/documents/${employeeId}/${encodeURIComponent(signatureDocument.fileName)}`
    : null;
  const employeeName =
    [submission.firstName, submission.lastName]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ") ||
    [onboardingSubmission.inviteFirstName, onboardingSubmission.inviteLastName]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ") ||
    `${employee.first_name} ${employee.last_name}`.trim();

  const sections: Array<{
    title: string;
    rows: Array<{ label: string; value: boolean | number | string | null | undefined }>;
  }> = [
    {
      title: "Person",
      rows: [
        { label: "Vorname", value: submission.firstName },
        { label: "Nachname", value: submission.lastName },
        { label: "E-Mail", value: submission.email ?? employee.email },
        { label: "Telefon", value: submission.phone },
        { label: "Geburtsdatum", value: submission.birthDate },
        { label: "Nationalitaet", value: submission.nationality },
        { label: "Familienstand", value: submission.maritalStatus },
      ],
    },
    {
      title: "Adresse",
      rows: [
        { label: "Strasse", value: submission.street },
        { label: "Hausnummer", value: submission.houseNumber },
        { label: "PLZ", value: submission.zipCode },
        { label: "Ort", value: submission.city },
        { label: "Bundesland", value: submission.federalState },
        { label: "Land", value: submission.country },
      ],
    },
    {
      title: "Steuer und Sozialversicherung",
      rows: [
        { label: "Steuerklasse", value: submission.taxClass },
        { label: "Kinderfreibetrag", value: submission.kinderfreibetrag },
        { label: "Steuer-ID", value: submission.steuerId },
        { label: "Sozialversicherungsnummer", value: submission.socialSecurityNumber },
        { label: "Krankenkasse", value: submission.healthInsurance },
        { label: "Krankenversicherungsnummer", value: submission.healthInsuranceNumber },
      ],
    },
    {
      title: "Bank und Notfallkontakt",
      rows: [
        { label: "IBAN", value: submission.iban },
        { label: "BIC", value: submission.bic },
        { label: "Notfallkontakt", value: submission.emergencyContactName },
        { label: "Notfallkontakt Telefon", value: submission.emergencyContactPhone },
        { label: "Beziehung", value: submission.emergencyContactRelation },
      ],
    },
    {
      title: "Beschaeftigung",
      rows: [
        { label: "Eintrittsdatum", value: adminPreset?.entryDate },
        { label: "Tarifgruppe", value: adminPreset?.tarifGroup },
        { label: "Beschaeftigungsart", value: adminPreset?.employmentType },
        { label: "Arbeitszeitmodell", value: adminPreset?.workTimeModel },
        { label: "Wochenstunden", value: adminPreset?.weeklyHours },
        { label: "Probezeit (Monate)", value: adminPreset?.probationMonths },
        { label: "Verguetungsart", value: adminPreset?.compensationType },
        { label: "Stundenlohn", value: adminPreset?.hourlyWage },
        { label: "Monatsgehalt brutto", value: adminPreset?.monthlySalaryGross },
        { label: "Urlaubstage gesamt", value: adminPreset?.vacationDaysTotal },
      ],
    },
  ];

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8 text-slate-900">
      {printMode ? (
        <>
          <Script id="personalbogen-auto-print" strategy="afterInteractive">
            {`window.addEventListener('load', () => window.setTimeout(() => window.print(), 150), { once: true });`}
          </Script>
          <style>{`
            @media print {
              body { background: #ffffff; }
              .no-print { display: none !important; }
              main { max-width: none !important; padding: 0 !important; }
              section { box-shadow: none !important; break-inside: avoid; }
              a { color: inherit !important; text-decoration: none !important; }
            }
          `}</style>
        </>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">Admin / Mitarbeitende / Personalbogen</p>
          <h1 className="text-2xl font-semibold text-slate-900">{employeeName}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Eingegangen am {formatDateTime(onboardingSubmission.submittedAt)}
          </p>
        </div>
        <Link
          href={`/admin/mitarbeitende/${employeeId}`}
          className="no-print inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Zur Mitarbeiterakte
        </Link>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Uebermittlung</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-slate-500">Einladung erstellt</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {formatDateTime(onboardingSubmission.inviteCreatedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500">Einladung gesendet an</dt>
            <dd className="mt-1 text-sm text-slate-900">{onboardingSubmission.inviteEmail}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500">Signaturname</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {formatValue(onboardingSubmission.signatureName)}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500">Signatur bestaetigt am</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {formatDateTime(onboardingSubmission.signatureAcceptedAt)}
            </dd>
          </div>
        </dl>
      </section>

      {sections.map((section) => (
        <section
          key={section.title}
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
          <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {section.rows.map((row) => (
              <div key={row.label}>
                <dt className="text-sm font-medium text-slate-500">{row.label}</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-900">
                  {formatValue(row.value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      {signatureImageUrl ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Unterschrift</h2>
              <p className="mt-1 text-sm text-slate-600">Gespeicherte Signatur aus dem eingegangenen Personalbogen.</p>
            </div>
            <Link
              href={signatureImageUrl}
              target="_blank"
              className="no-print inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Signaturdatei oeffnen
            </Link>
          </div>
          <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signatureImageUrl}
              alt={`Unterschrift ${employeeName}`}
              className="max-h-48 w-auto rounded border border-slate-200 bg-white object-contain"
            />
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Dateien</h2>
        {attachmentDocuments.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {attachmentDocuments.map((document) => (
              <li key={document.fileName} className="flex flex-wrap items-center gap-3 text-sm">
                <Link
                  href={`/api/documents/${employeeId}/${encodeURIComponent(document.fileName)}`}
                  target="_blank"
                  className="font-medium text-sky-700 hover:text-sky-800 hover:underline"
                >
                  {document.originalName}
                </Link>
                <span className="text-slate-500">{document.uploadedAt}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-600">Keine weiteren hochgeladenen Dateien vorhanden.</p>
        )}
      </section>
    </main>
  );
}
