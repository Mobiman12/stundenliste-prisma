export const metadata = {
  title: 'Testzeitraum abgelaufen – Stundenliste',
};

export default function TrialExpiredPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand">Stundenliste</p>
          <h1 className="text-2xl font-semibold text-slate-900">Testzeitraum abgelaufen</h1>
          <p className="text-sm text-slate-500">Der Zugang zu diesem Tenant ist nicht mehr aktiv.</p>
        </div>
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Bitte wende dich an den Administrator, um den Zugang zu verlaengern.
        </div>
      </div>
    </div>
  );
}
