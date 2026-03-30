'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COUNTRY_OPTIONS,
  getFederalStateOptions,
  normalizeCountry,
  resolveFederalStateByPostalCode,
  type CountryCode,
} from '@/lib/region-options';

import type {
  OnboardingInviteAdminPreset,
  OnboardingTenantBranding,
} from '@/lib/services/employee-onboarding';

type OnboardingFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
  warnings?: string[];
};

type SubmittedPrintRow = {
  label: string;
  value: string;
};

type Props = {
  token: string;
  inviteEmail: string;
  inviteFirstName?: string | null;
  inviteLastName?: string | null;
  expiresAtLabel: string;
  adminPreset: OnboardingInviteAdminPreset | null;
  tenantBranding: OnboardingTenantBranding | null;
};

function formatBirthDateInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

function FormMessage({ state }: { state: OnboardingFormState }) {
  if (state.status === 'idle' || !state.message) return null;
  const isSuccess = state.status === 'success';
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        isSuccess ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'
      }`}
    >
      <p>{state.message}</p>
      {isSuccess && state.warnings?.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-700">
          {state.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SignaturePad({
  value,
  onChange,
  onDrawStateChange,
}: {
  value: string;
  onChange: (next: string) => void;
  onDrawStateChange: (hasDrawing: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const nextWidth = Math.max(Math.floor(wrapper.clientWidth), 280);
      const nextHeight = 170;

      canvas.width = Math.floor(nextWidth * ratio);
      canvas.height = Math.floor(nextHeight * ratio);
      canvas.style.width = `${nextWidth}px`;
      canvas.style.height = `${nextHeight}px`;

      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineWidth = 2;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.strokeStyle = '#0f172a';

      if (value) {
        const image = new Image();
        image.onload = () => {
          context.clearRect(0, 0, nextWidth, nextHeight);
          context.drawImage(image, 0, 0, nextWidth, nextHeight);
        };
        image.src = value;
      }
    };

    resize();
    setReady(true);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [onChange, value]);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const point = getPoint(event);
    if (!canvas || !context || !point) return;
    onDrawStateChange(true);
    drawingRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const point = getPoint(event);
    if (!canvas || !context || !point) return;
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const finishSignature = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = false;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // no-op
    }
    const next = canvas.toDataURL('image/png');
    onChange(next);
    onDrawStateChange(true);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    onChange('');
    onDrawStateChange(false);
  };

  return (
    <div className="space-y-2">
      <div
        ref={wrapperRef}
        className="overflow-hidden rounded-xl border border-slate-300 bg-slate-50"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishSignature}
          onPointerCancel={finishSignature}
          className="block h-[170px] w-full touch-none"
          aria-label="Unterschriftsfeld"
        />
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{ready ? 'Bitte mit Finger oder Maus unterschreiben.' : 'Unterschriftsfeld wird geladen…'}</span>
        <button
          type="button"
          onClick={clear}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          Löschen
        </button>
      </div>
    </div>
  );
}

export default function OnboardingForm({
  token,
  inviteEmail,
  inviteFirstName,
  inviteLastName,
  expiresAtLabel,
  adminPreset,
  tenantBranding,
}: Props) {
  const [state, setState] = useState<OnboardingFormState>({ status: 'idle' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState('');
  const [signatureHasDrawing, setSignatureHasDrawing] = useState(false);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [submittedRows, setSubmittedRows] = useState<SubmittedPrintRow[]>([]);

  const suggestedName = useMemo(() => {
    return [inviteFirstName, inviteLastName].filter(Boolean).join(' ').trim();
  }, [inviteFirstName, inviteLastName]);
  const hasAdminPreset = Boolean(adminPreset);
  const logoUrl = tenantBranding?.logoUrl ?? null;
  const companyAddressLines = tenantBranding?.companyAddressLines ?? [];
  const adminCompensationType = adminPreset?.compensationType === 'fixed' ? 'Festgehalt (Brutto)' : 'Stundenlohn';
  const [birthDate, setBirthDate] = useState('');
  const [country, setCountry] = useState<CountryCode>('DE');
  const [federalState, setFederalState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [city, setCity] = useState('');
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [useCitySelect, setUseCitySelect] = useState(false);
  const [manualCompensationType, setManualCompensationType] = useState<'hourly' | 'fixed'>('hourly');
  const [profilePhotoLabel, setProfilePhotoLabel] = useState('Keine Datei ausgewählt');
  const [attachmentsLabel, setAttachmentsLabel] = useState('Keine Datei ausgewählt');
  const autoCityRef = useRef(true);
  const pendingCityRequest = useRef<AbortController | null>(null);
  const lastCityLookup = useRef('');

  const federalStateOptions = useMemo(() => getFederalStateOptions(country), [country]);
  const postalDigits = zipCode.replace(/\D/g, '');
  const postalMaxLength = country === 'DE' ? 5 : 4;
  const hasMultipleCities = cityOptions.length > 1;
  const citySelectValue =
    hasMultipleCities && useCitySelect && cityOptions.includes(city) ? city : '__manual__';
  const showCityInput = !hasMultipleCities || citySelectValue === '__manual__';

  useEffect(() => {
    const normalizedCountry = normalizeCountry(country);
    const inferred = resolveFederalStateByPostalCode(normalizedCountry, postalDigits);
    if (inferred) {
      setFederalState(inferred);
      return;
    }
    if (!federalStateOptions.some((option) => option.code === federalState)) {
      setFederalState('');
    }
  }, [country, federalState, federalStateOptions, postalDigits]);

  useEffect(() => {
    if (postalDigits.length < 4) {
      setCityOptions([]);
      setUseCitySelect(false);
      return;
    }

    const lookupKey = `${country}:${postalDigits}`;
    if (lookupKey === lastCityLookup.current) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      pendingCityRequest.current?.abort();
      const controller = new AbortController();
      pendingCityRequest.current = controller;
      try {
        const response = await fetch(
          `/api/postal-lookup?country=${encodeURIComponent(country)}&postalCode=${encodeURIComponent(postalDigits)}`,
          { signal: controller.signal }
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { city?: string | null; cities?: string[] } | null;
        const options = Array.isArray(payload?.cities)
          ? payload.cities.filter((item) => typeof item === 'string' && item.trim().length > 0)
          : [];
        setCityOptions(options);
        if (options.length > 1) {
          setUseCitySelect(true);
          if ((autoCityRef.current || !city) && options[0] && city !== options[0]) {
            autoCityRef.current = true;
            setCity(options[0]);
          }
        } else {
          setUseCitySelect(false);
          if (options.length === 1 && (autoCityRef.current || !city) && city !== options[0]) {
            autoCityRef.current = true;
            setCity(options[0]);
          }
        }
        lastCityLookup.current = lookupKey;
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('[onboarding-postal-lookup] failed', error);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      pendingCityRequest.current?.abort();
    };
  }, [city, country, postalDigits]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-brand/20 bg-brand/5 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Personalbogen</p>
            <h1 className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">Personalbogen sicher ausfüllen</h1>
            <p className="mt-2 text-sm text-slate-700">
              Dieser Link ist einmalig und gültig bis <strong>{expiresAtLabel}</strong>.
            </p>
            <p className="mt-1 text-sm text-slate-700">
              Vorgemerkte E-Mail: <strong>{inviteEmail}</strong>
            </p>
          </div>
          <div className="sm:text-right">
            {logoUrl ? (
              <img src={logoUrl} alt="Tenant-Logo" className="h-14 w-auto object-contain sm:ml-auto" />
            ) : null}
            {companyAddressLines.length ? (
              <div className="mt-2 space-y-0.5 text-xs text-slate-600">
                {companyAddressLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <FormMessage state={state} />
      {state.status === 'success' ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800 sm:p-6">
          <div className="print:hidden">
            <p className="font-semibold">Personalbogen erfolgreich gesendet.</p>
            <p className="mt-1">Du kannst den Personalbogen jetzt drucken oder als PDF speichern.</p>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-emerald-200 bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <tbody>
                {submittedRows.map((row) => (
                  <tr key={`submitted-row-${row.label}`} className="border-b border-emerald-100 last:border-b-0">
                    <th className="w-44 bg-emerald-50/60 px-3 py-2 font-semibold text-emerald-900">{row.label}</th>
                    <td className="px-3 py-2 text-slate-800">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              Drucken
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              Als PDF speichern
            </button>
          </div>
        </section>
      ) : null}

      {state.status === 'success' ? null : (
        <form
          className="space-y-6 pb-8"
          encType="multipart/form-data"
          onSubmit={async (event) => {
            if (!signatureHasDrawing || !signatureDataUrl) {
              event.preventDefault();
              setSignatureError('Bitte unterschreibe im Unterschriftsfeld.');
              return;
            }
            event.preventDefault();
            setSignatureError(null);
            setIsSubmitting(true);
            try {
              const formData = new FormData(event.currentTarget);
              formData.set('token', token);
              formData.set('signature_data_url', signatureDataUrl);
              const asValue = (name: string): string => {
                const raw = String(formData.get(name) ?? '').trim();
                return raw || '—';
              };
              const printRows: SubmittedPrintRow[] = [
                { label: 'Vorname', value: asValue('first_name') },
                { label: 'Nachname', value: asValue('last_name') },
                { label: 'E-Mail', value: asValue('email') },
                { label: 'Telefon', value: asValue('phone') },
                { label: 'Geburtsdatum', value: asValue('birth_date') },
                { label: 'Straße', value: asValue('street') },
                { label: 'Hausnummer', value: asValue('house_number') },
                { label: 'PLZ', value: asValue('zip_code') },
                { label: 'Ort', value: asValue('city') },
                { label: country === 'CH' ? 'Kanton' : 'Bundesland', value: asValue('federal_state') },
                { label: 'Eintrittsdatum', value: asValue('entry_date') },
                { label: 'Tarifgruppe / Jobtitel', value: asValue('tarif_group') },
                { label: 'Einstellungsart', value: asValue('employment_type') },
                { label: 'Arbeitszeitmodell', value: asValue('work_time_model') },
                { label: 'Std/Woche', value: asValue('weekly_hours') },
                { label: 'Probezeit (Monate)', value: asValue('probation_months') },
                { label: 'Vergütungsart', value: asValue('compensation_type') },
                { label: 'Stundenlohn (€)', value: asValue('hourly_wage') },
                { label: 'Monatsgehalt Brutto (€)', value: asValue('monthly_salary_gross') },
                { label: 'Urlaubstage/Jahr', value: asValue('vacation_days_total') },
                { label: 'Steuerklasse', value: asValue('tax_class') },
                { label: 'Steuer-ID', value: asValue('steuer_id') },
                { label: 'Sozialversicherungsnummer', value: asValue('social_security_number') },
                { label: 'Signaturname', value: asValue('signature_name') },
              ];
              setSubmittedRows(printRows);

              const response = await fetch('/api/onboarding/submit', {
                method: 'POST',
                body: formData,
              });
              const payload = (await response.json().catch(() => null)) as OnboardingFormState | null;
              if (!response.ok) {
                setState({
                  status: 'error',
                  message: payload?.message || 'Formular konnte nicht gesendet werden.',
                });
                return;
              }
              setState(payload ?? { status: 'success', message: 'Personalbogen erfolgreich gesendet.' });
            } catch {
              setState({
                status: 'error',
                message: 'Formular konnte nicht gesendet werden.',
              });
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="signature_data_url" value={signatureDataUrl} />

          <Section title="Personendaten">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Vorname *</span>
                <input name="first_name" defaultValue={inviteFirstName ?? ''} required className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Nachname *</span>
                <input name="last_name" defaultValue={inviteLastName ?? ''} required className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
                <span>E-Mail *</span>
                <input type="email" name="email" required defaultValue={inviteEmail} className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Telefon *</span>
                <input
                  type="tel"
                  name="phone"
                  required
                  inputMode="tel"
                  placeholder="017012345678"
                  className="rounded-md border border-slate-300 px-3 py-2 placeholder:text-slate-400"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Geburtsdatum *</span>
                <input
                  type="text"
                  name="birth_date"
                  required
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="TT.MM.JJJJ"
                  value={birthDate}
                  onChange={(event) => setBirthDate(formatBirthDateInput(event.target.value))}
                  autoComplete="off"
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
            </div>
          </Section>

          {hasAdminPreset ? (
            <Section title="Vertragsdaten (vom Unternehmen vorgegeben)">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span>Eintrittsdatum *</span>
                  <input
                    value={adminPreset?.entryDate ?? ''}
                    readOnly
                    className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span>Tarifgruppe / Jobtitel *</span>
                  <input
                    value={adminPreset?.tarifGroup ?? ''}
                    readOnly
                    className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span>Einstellungsart *</span>
                  <input
                    value={adminPreset?.employmentType ?? ''}
                    readOnly
                    className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span>Arbeitszeitmodell *</span>
                  <input
                    value={adminPreset?.workTimeModel ?? ''}
                    readOnly
                    className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span>Std/Woche *</span>
                  <input
                    value={String(adminPreset?.weeklyHours ?? '')}
                    readOnly
                    className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span>Probezeit (Monate) *</span>
                  <input
                    value={String(adminPreset?.probationMonths ?? '')}
                    readOnly
                    className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                  />
                </label>
              </div>
              <input type="hidden" name="entry_date" value={adminPreset?.entryDate ?? ''} />
              <input type="hidden" name="tarif_group" value={adminPreset?.tarifGroup ?? ''} />
              <input type="hidden" name="employment_type" value={adminPreset?.employmentType ?? ''} />
              <input type="hidden" name="work_time_model" value={adminPreset?.workTimeModel ?? ''} />
              <input type="hidden" name="weekly_hours" value={String(adminPreset?.weeklyHours ?? '')} />
              <input type="hidden" name="probation_months" value={String(adminPreset?.probationMonths ?? '')} />
            </Section>
          ) : null}

          <Section title="Adresse & Beschäftigung">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Land *</span>
                <select
                  name="country"
                  value={country}
                  onChange={(event) => {
                    const nextCountry = normalizeCountry(event.target.value);
                    setCountry(nextCountry);
                    setZipCode('');
                    setCity('');
                    setCityOptions([]);
                    setUseCitySelect(false);
                    lastCityLookup.current = '';
                    autoCityRef.current = true;
                  }}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2"
                >
                  {COUNTRY_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
                <span>Straße *</span>
                <input name="street" required className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Hausnummer *</span>
                <input name="house_number" required className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>PLZ *</span>
                <input
                  name="zip_code"
                  value={zipCode}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, '').slice(0, postalMaxLength);
                    setZipCode(digits);
                    const inferred = resolveFederalStateByPostalCode(country, digits);
                    if (inferred) {
                      setFederalState(inferred);
                    }
                  }}
                  inputMode="numeric"
                  maxLength={postalMaxLength}
                  required
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              {hasMultipleCities ? (
                <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
                  <span>Ort *</span>
                  <select
                    value={citySelectValue}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      if (nextValue === '__manual__') {
                        setUseCitySelect(false);
                        autoCityRef.current = false;
                        return;
                      }
                      setUseCitySelect(true);
                      autoCityRef.current = false;
                      setCity(nextValue);
                    }}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2"
                  >
                    {cityOptions.map((option) => (
                      <option key={`city-option-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                    <option value="__manual__">Ort manuell eingeben</option>
                  </select>
                </label>
              ) : null}
              {showCityInput ? (
                <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
                  <span>Ort *</span>
                  <input
                    name="city"
                    value={city}
                    onChange={(event) => {
                      setCity(event.target.value);
                      autoCityRef.current = false;
                    }}
                    required
                    className="rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>
              ) : (
                <input type="hidden" name="city" value={city} />
              )}
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>{country === 'CH' ? 'Kanton *' : 'Bundesland *'}</span>
                <select
                  name="federal_state"
                  required
                  value={federalState}
                  onChange={(event) => setFederalState(event.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="" disabled>
                    Bitte auswählen
                  </option>
                  {federalStateOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {!hasAdminPreset ? (
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span>Std/Woche *</span>
                  <input type="number" step="0.5" min={0} name="weekly_hours" required className="rounded-md border border-slate-300 px-3 py-2" />
                </label>
              ) : null}
              {!hasAdminPreset ? (
                <>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Eintrittsdatum *</span>
                    <input type="date" name="entry_date" required className="rounded-md border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Tarifgruppe / Jobtitel *</span>
                    <input name="tarif_group" required className="rounded-md border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Einstellungsart *</span>
                    <select name="employment_type" required defaultValue="" className="rounded-md border border-slate-300 bg-white px-3 py-2">
                      <option value="" disabled>Bitte auswählen</option>
                      <option value="befristet">Befristet</option>
                      <option value="unbefristet">Unbefristet</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Arbeitszeitmodell *</span>
                    <select name="work_time_model" required defaultValue="" className="rounded-md border border-slate-300 bg-white px-3 py-2">
                      <option value="" disabled>Bitte auswählen</option>
                      <option value="vollzeit">Vollzeit</option>
                      <option value="teilzeit">Teilzeit</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Probezeit (Monate) *</span>
                    <input type="number" min={0} max={36} name="probation_months" required className="rounded-md border border-slate-300 px-3 py-2" />
                  </label>
                </>
              ) : null}
            </div>
          </Section>

          <Section title="Vergütung & Abrechnung">
            {hasAdminPreset ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Vergütungsart *</span>
                    <input value={adminCompensationType} readOnly className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Stundenlohn (€)</span>
                    <input
                      value={adminPreset?.hourlyWage != null ? adminPreset.hourlyWage.toFixed(2) : ''}
                      readOnly
                      className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                    />
                  </label>
                  {adminPreset?.compensationType === 'fixed' ? (
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      <span>Monatsgehalt Brutto (€)</span>
                      <input
                        value={adminPreset?.monthlySalaryGross != null ? adminPreset.monthlySalaryGross.toFixed(2) : ''}
                        readOnly
                        className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                      />
                    </label>
                  ) : null}
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Urlaubstage/Jahr *</span>
                    <input
                      value={String(adminPreset?.vacationDaysTotal ?? '')}
                      readOnly
                      className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                    />
                  </label>
                </div>
                <input type="hidden" name="compensation_type" value={adminPreset?.compensationType ?? 'hourly'} />
                <input type="hidden" name="hourly_wage" value={adminPreset?.hourlyWage != null ? String(adminPreset.hourlyWage) : ''} />
                <input type="hidden" name="monthly_salary_gross" value={adminPreset?.monthlySalaryGross != null ? String(adminPreset.monthlySalaryGross) : ''} />
                <input type="hidden" name="vacation_days_total" value={String(adminPreset?.vacationDaysTotal ?? '')} />
              </>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span>Vergütungsart *</span>
                  <select
                    name="compensation_type"
                    required
                    value={manualCompensationType}
                    onChange={(event) => setManualCompensationType(event.target.value === 'fixed' ? 'fixed' : 'hourly')}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="hourly">Stundenlohn</option>
                    <option value="fixed">Festgehalt (Brutto)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span>Stundenlohn (€) {manualCompensationType === 'hourly' ? '*' : ''}</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    name="hourly_wage"
                    required={manualCompensationType === 'hourly'}
                    className="rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>
                {manualCompensationType === 'fixed' ? (
                  <label className="flex flex-col gap-1 text-sm text-slate-700">
                    <span>Monatsgehalt Brutto (€) *</span>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      name="monthly_salary_gross"
                      required
                      className="rounded-md border border-slate-300 px-3 py-2"
                    />
                  </label>
                ) : null}
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  <span>Urlaubstage/Jahr *</span>
                  <input type="number" min={1} name="vacation_days_total" required className="rounded-md border border-slate-300 px-3 py-2" />
                </label>
              </div>
            )}
          </Section>

          <Section title="Steuer- & Sozialdaten">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Nationalität *</span>
                <input name="nationality" required className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Familienstand *</span>
                <input name="marital_status" required className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Steuerklasse *</span>
                <select name="tax_class" required defaultValue="" className="rounded-md border border-slate-300 bg-white px-3 py-2">
                  <option value="" disabled>Bitte auswählen</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                  <option value="6">6</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Kinderfreibetrag *</span>
                <input type="number" step="0.5" min={0} name="kinderfreibetrag" required className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
                <span>Steuer-ID *</span>
                <input
                  name="steuer_id"
                  required
                  placeholder="z. B. 12 345 678 901"
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
                <span>Sozialversicherungsnummer *</span>
                <input
                  name="social_security_number"
                  required
                  placeholder="z. B. 12 123456 A 123"
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Krankenkasse *</span>
                <input name="health_insurance" required className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Versichertennummer *</span>
                <input name="health_insurance_number" required className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
            </div>
          </Section>

          <Section title="Bankdaten">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>IBAN *</span>
                <input name="iban" required className="rounded-md border border-slate-300 px-3 py-2 uppercase" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>BIC *</span>
                <input name="bic" required className="rounded-md border border-slate-300 px-3 py-2 uppercase" />
              </label>
            </div>
          </Section>

          <Section title="Notfallkontakt (optional)">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
                <span>Notfallkontakt Name</span>
                <input name="emergency_contact_name" className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Notfallkontakt Telefon</span>
                <input type="tel" name="emergency_contact_phone" className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                <span>Beziehung</span>
                <input name="emergency_contact_relation" className="rounded-md border border-slate-300 px-3 py-2" />
              </label>
            </div>
          </Section>

          <Section title="Foto & Dokumente">
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span>Profilfoto (png/jpg/jpeg)</span>
              <div className="relative w-full overflow-hidden rounded-md border border-slate-300 bg-white">
                <input
                  type="file"
                  name="profile_photo"
                  accept=".png,.jpg,.jpeg"
                  className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    setProfilePhotoLabel(file?.name?.trim() ? file.name : 'Keine Datei ausgewählt');
                  }}
                />
                <div className="flex min-h-11 items-center gap-2 px-3 py-2">
                  <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                    Datei wählen
                  </span>
                  <span className="min-w-0 truncate text-xs text-slate-500">{profilePhotoLabel}</span>
                </div>
              </div>
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span>Anhänge (z. B. Zertifikate, Ausbildungsnachweise) – Mehrfachauswahl möglich</span>
              <div className="relative w-full overflow-hidden rounded-md border border-slate-300 bg-white">
                <input
                  type="file"
                  name="attachments"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                  onChange={(event) => {
                    const files = event.currentTarget.files;
                    if (!files || files.length === 0) {
                      setAttachmentsLabel('Keine Datei ausgewählt');
                      return;
                    }
                    if (files.length === 1) {
                      setAttachmentsLabel(files[0].name || '1 Datei ausgewählt');
                      return;
                    }
                    setAttachmentsLabel(`${files.length} Dateien ausgewählt`);
                  }}
                />
                <div className="flex min-h-11 items-center gap-2 px-3 py-2">
                  <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                    Dateien wählen
                  </span>
                  <span className="min-w-0 truncate text-xs text-slate-500">{attachmentsLabel}</span>
                </div>
              </div>
            </label>
            <p className="text-xs text-slate-500">Erlaubte Formate: PDF, PNG, JPG, JPEG. Maximal 10 MB pro Datei.</p>
          </Section>

          <Section title="Digitale Unterschrift">
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span>Name der unterschreibenden Person *</span>
              <input
                name="signature_name"
                required
                defaultValue={suggestedName}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <SignaturePad
              value={signatureDataUrl}
              onChange={setSignatureDataUrl}
              onDrawStateChange={setSignatureHasDrawing}
            />
            {signatureError ? <p className="text-sm text-red-600">{signatureError}</p> : null}
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" name="consent_accepted" required className="mt-1 h-4 w-4" />
              <span>
                Ich bestätige die Richtigkeit meiner Angaben und stimme der sicheren Übermittlung sowie Verarbeitung
                meiner personenbezogenen Daten durch das Unternehmen zu.
              </span>
            </label>
          </Section>

          <div className="sticky bottom-0 z-10 rounded-2xl border border-slate-200 bg-white/95 p-4 backdrop-blur">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white shadow hover:opacity-90"
            >
              {isSubmitting ? 'Wird gesendet…' : 'Personalbogen senden'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
