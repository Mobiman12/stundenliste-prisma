"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

type CustomerProfileDrawerProps = {
  open: boolean;
  customerId: string | null;
  locationSlug: string;
  onClose: () => void;
  onUpdated?: () => void;
};

type CustomerPayload = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  categoryId: string | null;
  appointmentCount: number;
  createdAt: string;
};

type CategoryOption = {
  id: string;
  name: string;
  color: string | null;
};

type CustomerResponse = {
  customer: CustomerPayload;
  categories: CategoryOption[];
};

export function CustomerProfileDrawer({
  open,
  customerId,
  locationSlug,
  onClose,
  onUpdated,
}: CustomerProfileDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CustomerResponse | null>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    categoryId: "",
  });

  useEffect(() => {
    if (!open || !customerId) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/backoffice/${locationSlug}/customers/${customerId}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "Kunde konnte nicht geladen werden.");
        }
        setData(payload as CustomerResponse);
        setForm({
          firstName: payload.customer.firstName ?? "",
          lastName: payload.customer.lastName ?? "",
          email: payload.customer.email ?? "",
          phone: payload.customer.phone ?? "",
          categoryId: payload.customer.categoryId ?? "",
        });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Kunde konnte nicht geladen werden.");
      })
      .finally(() => setLoading(false));
  }, [open, customerId, locationSlug]);

  const customerName = useMemo(() => {
    if (!data?.customer) {
      return "";
    }
    return `${data.customer.firstName ?? ""} ${data.customer.lastName ?? ""}`.trim();
  }, [data]);

  if (!open) {
    return null;
  }

  const handleSubmit = async () => {
    if (!customerId) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/backoffice/${locationSlug}/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          categoryId: form.categoryId || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Kunde konnte nicht gespeichert werden.");
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              customer: {
                ...prev.customer,
                ...payload.customer,
              },
            }
          : prev,
      );
      if (onUpdated) {
        onUpdated();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunde konnte nicht gespeichert werden.");
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = loading || submitting || !data;

  return (
    <div className="fixed inset-0 z-[1800] flex justify-end bg-black/30 backdrop-blur" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-lg flex-col rounded-l-3xl border border-zinc-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-zinc-400">Kundenprofil</p>
            <h2 className="text-xl font-semibold text-zinc-900">{customerName || "Kunde"}</h2>
            {data?.customer && (
              <p className="text-xs text-zinc-500">
                {data.customer.appointmentCount} Termin(e) · seit{" "}
                {new Date(data.customer.createdAt).toLocaleDateString("de-DE")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 disabled:cursor-not-allowed disabled:bg-zinc-400"
            disabled={submitting}
          >
            Schließen
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loading ? (
            <div className="flex h-full items-center justify-center text-zinc-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Daten werden geladen …
            </div>
          ) : data ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                handleSubmit();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-zinc-700">
                  Vorname
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                    value={form.firstName}
                    onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
                    required
                    disabled={disabled}
                  />
                </label>
                <label className="text-sm font-medium text-zinc-700">
                  Nachname
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                    value={form.lastName}
                    onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
                    required
                    disabled={disabled}
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-zinc-700">
                  E-Mail
                  <input
                    type="email"
                    className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                    value={form.email}
                    onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                    disabled={disabled}
                  />
                </label>
                <label className="text-sm font-medium text-zinc-700">
                  Telefon
                  <input
                    type="tel"
                    className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                    value={form.phone}
                    onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                    disabled={disabled}
                  />
                </label>
              </div>

              <label className="text-sm font-medium text-zinc-700">
                Kategorie
                <select
                  className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                  value={form.categoryId}
                  onChange={(event) => setForm((prev) => ({ ...prev, categoryId: event.target.value }))}
                  disabled={disabled}
                >
                  <option value="">Keine Kategorie</option>
                  {data.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              {error ? (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
              ) : null}

              <div className="flex items-center justify-between border-t border-zinc-200 pt-4 text-xs text-zinc-500">
                <span>
                  {data.customer.appointmentCount} Termin(e) · ID {data.customer.id}
                </span>
                <button
                  type="submit"
                  className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-500"
                  disabled={disabled}
                >
                  {submitting ? "Speichert …" : "Änderungen sichern"}
                </button>
              </div>
            </form>
          ) : (
            <div className="text-sm text-rose-600">{error ?? "Kunde konnte nicht geladen werden."}</div>
          )}
        </div>
      </div>
    </div>
  );
}
