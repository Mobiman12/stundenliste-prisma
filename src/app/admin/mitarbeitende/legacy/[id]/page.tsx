import { notFound, redirect } from 'next/navigation';

import { getServerAuthSession } from '@/lib/auth/session';
import { getEmployeeById } from '@/lib/data/employees';
import { withAppBasePath } from '@/lib/routes';

interface Props {
  params: { id: string };
}

export default async function AdminEmployeeDetailPage({ params }: Props) {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.roleId !== 2) {
    redirect(withAppBasePath('/login'));
  }
  const tenantId = session.tenantId;
  if (!tenantId) {
    redirect(withAppBasePath('/login'));
  }

  const employeeId = Number(params.id);
  if (!employeeId) {
    notFound();
  }

  const employee = await getEmployeeById(tenantId, employeeId);
  if (!employee) {
    notFound();
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-900">
          {employee.first_name} {employee.last_name}
        </h2>
        <p className="text-sm text-slate-500">Benutzername: {employee.username}</p>
      </header>

      <dl className="grid gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <InfoItem label="E-Mail" value={employee.email ?? '–'} />
        <InfoItem label="Telefon" value={employee.phone ?? '–'} />
        <InfoItem label="Personalnummer" value={employee.personnel_number ?? '–'} />
        <InfoItem label="Eintrittsdatum" value={formatDate(employee.entry_date)} />
        <InfoItem label="Wochenstunden" value={employee.weekly_hours ? `${employee.weekly_hours} h` : '–'} />
        <InfoItem label="Rolle" value={employee.role_id === 2 ? 'Administrator' : 'Mitarbeiter'} />
      </dl>

      <p className="text-sm text-slate-500">
        Stammdatenbearbeitung, Dokumenten-Upload und Stundenkonto werden in einem späteren Schritt integriert.
      </p>
    </section>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{value}</dd>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('de-DE');
}
