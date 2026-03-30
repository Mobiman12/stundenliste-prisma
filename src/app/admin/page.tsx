import { getServerAuthSession } from '@/lib/auth/session';

export default async function AdminHomePage() {
  const session = await getServerAuthSession();

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-900">Willkommen zurück, {session?.user.firstName ?? session?.user.username}!</h2>
        <p className="text-sm text-slate-500">
          Diese Startseite ist der Ausgangspunkt für das zukünftige Admin-Dashboard. Hier binden wir später
          Auswertungen zu Stundenkonten, Reminder-Status und offene Monatsabschlüsse ein.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700">Nächste Schritte</h3>
          <ol className="mt-3 space-y-2 text-sm text-slate-600">
            <li>• API-Routen für Mitarbeiter- und Tagesdaten anbinden</li>
            <li>• Monatsabschluss-Workflow in Next.js übertragen</li>
            <li>• Rollenbasierte KPIs und Benachrichtigungen visualisieren</li>
          </ol>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700">Offene Themen</h3>
          <p className="mt-3 text-sm text-slate-600">
            Import der Streamlit-Funktionen für Mitarbeiterverwaltung, Dokumente und Schichtplan.
            Die Komponenten werden schrittweise in React übertragen.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700">Systemstatus</h3>
          <p className="mt-3 text-sm text-slate-600">
            Datenbank-Verbindung aktiv. Benutzerverwaltung via NextAuth und SQLite vorbereitet.
          </p>
        </div>
      </div>
    </section>
  );
}
