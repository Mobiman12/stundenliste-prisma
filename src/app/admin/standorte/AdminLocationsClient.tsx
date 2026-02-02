'use client';

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';

import type { BranchScheduleRule, BranchWeekday } from '@/lib/data/branches';
import {
  COUNTRY_OPTIONS,
  getDefaultTimezone,
  getFederalStateOptions,
  normalizeCountry,
  resolveFederalStateByPostalCode,
} from '@/lib/region-options';

export type LocationActionState = {
  status: 'success' | 'error';
  message: string;
} | null;

type Location = {
  id: number;
  slug: string;
  name: string;
  timezone: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  country: string;
  federalState: string | null;
  phone: string;
  email: string;
  metadata: Record<string, unknown> | null;
  schedule: BranchScheduleRule[];
};

type Props = {
  locations: Location[];
  createAction: (prevState: LocationActionState, formData: FormData) => Promise<LocationActionState>;
  updateAction: (formData: FormData) => Promise<LocationActionState>;
  deleteAction: (formData: FormData) => Promise<LocationActionState>;
};

type PendingState = {
  id: number | null;
  type: 'update' | 'delete' | null;
};

type ScheduleSegment = {
  id: string;
  start: string;
  end: string;
};

type DayScheduleState = {
  isClosed: boolean;
  segments: ScheduleSegment[];
};

type WeeklyScheduleState = Record<BranchWeekday, DayScheduleState>;

const WEEKDAYS: BranchWeekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

const WEEKDAY_LABEL: Record<BranchWeekday, string> = {
  MONDAY: 'Montag',
  TUESDAY: 'Dienstag',
  WEDNESDAY: 'Mittwoch',
  THURSDAY: 'Donnerstag',
  FRIDAY: 'Freitag',
  SATURDAY: 'Samstag',
  SUNDAY: 'Sonntag',
};

function createSegmentId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function minutesToTime(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) {
    return '';
  }
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function timeToMinutes(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  const total = hours * 60 + minutes;
  if (total < 0 || total > 1440) {
    return null;
  }
  return total;
}

function createEmptyScheduleState(): WeeklyScheduleState {
  return WEEKDAYS.reduce((state, weekday) => {
    state[weekday] = { isClosed: true, segments: [] };
    return state;
  }, {} as WeeklyScheduleState);
}

function buildScheduleState(rules: BranchScheduleRule[]): WeeklyScheduleState {
  const state = createEmptyScheduleState();

  for (const rule of rules) {
    if (!state[rule.weekday]) continue;
    if (!rule.isActive || rule.startsAtMinutes == null || rule.endsAtMinutes == null) {
      continue;
    }
    state[rule.weekday].segments.push({
      id: createSegmentId(),
      start: minutesToTime(rule.startsAtMinutes),
      end: minutesToTime(rule.endsAtMinutes),
    });
  }

  for (const weekday of WEEKDAYS) {
    const day = state[weekday];
    if (day.segments.length) {
      day.isClosed = false;
    } else {
      day.isClosed = true;
    }
  }

  return state;
}

type SerializedSchedule =
  | {
      weekday: BranchWeekday;
      startsAtMinutes: number | null;
      endsAtMinutes: number | null;
      isActive: boolean;
    }[];

function serializeScheduleState(state: WeeklyScheduleState): {
  payload: SerializedSchedule;
  errors: string[];
} {
  const payload: SerializedSchedule = [];
  const errors: string[] = [];

  for (const weekday of WEEKDAYS) {
    const day = state[weekday];
    if (day.isClosed || day.segments.length === 0) {
      payload.push({
        weekday,
        startsAtMinutes: null,
        endsAtMinutes: null,
        isActive: false,
      });
      continue;
    }

    const segments = [...day.segments].sort((a, b) => {
      const aMinutes = timeToMinutes(a.start) ?? 0;
      const bMinutes = timeToMinutes(b.start) ?? 0;
      return aMinutes - bMinutes;
    });

    let previousEnd: number | null = null;
    segments.forEach((segment) => {
      const start = timeToMinutes(segment.start);
      const end = timeToMinutes(segment.end);

      if (start == null || end == null) {
        errors.push(`${WEEKDAY_LABEL[weekday]}: Zeitspannen erfordern Start- und Endzeit.`);
        return;
      }
      if (start >= end) {
        errors.push(`${WEEKDAY_LABEL[weekday]}: Endzeit muss nach der Startzeit liegen.`);
        return;
      }
      if (previousEnd != null && start < previousEnd) {
        errors.push(`${WEEKDAY_LABEL[weekday]}: Zeitspannen dürfen sich nicht überlappen.`);
        return;
      }

      previousEnd = end;
      payload.push({
        weekday,
        startsAtMinutes: start,
        endsAtMinutes: end,
        isActive: true,
      });
    });
  }

  return { payload, errors: Array.from(new Set(errors)) };
}

function useScheduleState(initial: BranchScheduleRule[]) {
  const [schedule, setSchedule] = useState<WeeklyScheduleState>(() => buildScheduleState(initial));

  const setScheduleDirect = useCallback(
    (next: WeeklyScheduleState) => {
      setSchedule(next);
    },
    [setSchedule]
  );

  const setDayClosed = useCallback(
    (weekday: BranchWeekday, isClosed: boolean) => {
      setSchedule((prev) => {
        const day = prev[weekday];
        if (!day) {
          return prev;
        }

        const nextSegments = isClosed
          ? []
          : day.segments.length
          ? day.segments.map((segment) => ({ ...segment }))
          : [
              {
                id: createSegmentId(),
                start: '09:00',
                end: '18:00',
              },
            ];

        const nextDay: DayScheduleState = {
          isClosed,
          segments: nextSegments,
        };

        return {
          ...prev,
          [weekday]: nextDay,
        };
      });
    },
    [setSchedule]
  );

  const updateSegment = useCallback(
    (weekday: BranchWeekday, segmentId: string, field: 'start' | 'end', value: string) => {
      setSchedule((prev) => {
        const day = prev[weekday];
        if (!day) {
          return prev;
        }
        const nextSegments = day.segments.map((segment) =>
          segment.id === segmentId ? { ...segment, [field]: value } : segment
        );
        if (nextSegments === day.segments) {
          return prev;
        }
        return {
          ...prev,
          [weekday]: {
            ...day,
            segments: nextSegments,
          },
        };
      });
    },
    [setSchedule]
  );

  const addSegment = useCallback(
    (weekday: BranchWeekday) => {
      setSchedule((prev) => {
        const day = prev[weekday];
        if (!day) {
          return prev;
        }
        const last = day.segments.at(-1);
        const fallbackStart = last ? last.end : '09:00';
        const fallbackEnd = last ? last.end : '18:00';
        const nextSegments = [
          ...day.segments,
          {
            id: createSegmentId(),
            start: fallbackStart,
            end: fallbackEnd,
          },
        ];
        return {
          ...prev,
          [weekday]: {
            isClosed: false,
            segments: nextSegments,
          },
        };
      });
    },
    [setSchedule]
  );

  const removeSegment = useCallback(
    (weekday: BranchWeekday, segmentId: string) => {
      setSchedule((prev) => {
        const day = prev[weekday];
        if (!day) {
          return prev;
        }
        const nextSegments = day.segments.filter((segment) => segment.id !== segmentId);
        return {
          ...prev,
          [weekday]: {
            isClosed: nextSegments.length === 0,
            segments: nextSegments,
          },
        };
      });
    },
    [setSchedule]
  );

  const applyPreset = useCallback(
    (preset: 'standard' | 'reset') => {
      if (preset === 'reset') {
        setSchedule(createEmptyScheduleState());
        return;
      }
      if (preset === 'standard') {
        setSchedule(() => {
          const next = createEmptyScheduleState();
          for (const weekday of WEEKDAYS) {
            if (weekday === 'SATURDAY' || weekday === 'SUNDAY') {
              next[weekday] = { isClosed: true, segments: [] };
            } else {
              next[weekday] = {
                isClosed: false,
                segments: [
                  {
                    id: createSegmentId(),
                    start: '09:00',
                    end: '18:00',
                  },
                ],
              };
            }
          }
          return next;
        });
      }
    },
    [setSchedule]
  );

  return useMemo(
    () => ({
      schedule,
      setSchedule: setScheduleDirect,
      setDayClosed,
      updateSegment,
      addSegment,
      removeSegment,
      applyPreset,
    }),
    [schedule, setScheduleDirect, setDayClosed, updateSegment, addSegment, removeSegment, applyPreset]
  );
}

function ScheduleEditor({
  state,
  disabled = false,
  onChange,
}: {
  state: ReturnType<typeof useScheduleState>;
  disabled?: boolean;
  onChange?: (schedule: WeeklyScheduleState) => void;
}) {
  const { schedule, setDayClosed, updateSegment, addSegment, removeSegment, applyPreset } = state;

  useEffect(() => {
    onChange?.(schedule);
  }, [schedule, onChange]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => applyPreset('standard')}
          disabled={disabled}
          className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Mo-Fr 09:00-18:00 setzen
        </button>
        <button
          type="button"
          onClick={() => applyPreset('reset')}
          disabled={disabled}
          className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Alles schließen
        </button>
      </div>
      <div className="grid gap-4">
        {WEEKDAYS.map((weekday) => {
          const day = schedule[weekday];
          return (
            <div
              key={weekday}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-slate-800">{WEEKDAY_LABEL[weekday]}</h3>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={!day.isClosed}
                    onChange={(event) => setDayClosed(weekday, !event.target.checked)}
                    disabled={disabled}
                  />
                  <span>Geöffnet</span>
                </label>
              </div>

              {day.isClosed ? (
                <p className="mt-2 text-xs text-slate-500">Dieser Standort ist an diesem Tag geschlossen.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {day.segments.map((segment, index) => (
                    <div
                      key={segment.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white p-3"
                    >
                      <span className="text-xs font-medium text-slate-500">Zeitfenster {index + 1}</span>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 text-xs text-slate-600">
                          <span>Von</span>
                          <input
                            type="time"
                            value={segment.start}
                            onChange={(event) => updateSegment(weekday, segment.id, 'start', event.target.value)}
                            disabled={disabled}
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-slate-600">
                          <span>Bis</span>
                          <input
                            type="time"
                            value={segment.end}
                            onChange={(event) => updateSegment(weekday, segment.id, 'end', event.target.value)}
                            disabled={disabled}
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSegment(weekday, segment.id)}
                        disabled={disabled || day.segments.length === 1}
                        className="ml-auto rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        title="Zeitfenster entfernen"
                      >
                        Entfernen
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addSegment(weekday)}
                    disabled={disabled}
                    className="rounded-md border border-dashed border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Weiteres Zeitfenster hinzufügen
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LocationDetailPanel({
  location,
  pending,
  onUpdate,
  onDelete,
}: {
  location: Location;
  pending: PendingState;
  onUpdate: (branchId: number, formData: FormData) => void;
  onDelete: (branchId: number) => void;
}) {
  const [formValues, setFormValues] = useState({
    name: location.name,
    slug: location.slug,
    timezone: location.timezone,
    addressLine1: location.addressLine1,
    addressLine2: location.addressLine2,
    postalCode: location.postalCode,
    city: location.city,
    country: normalizeCountry(location.country),
    federalState: location.federalState ?? '',
    phone: location.phone,
    email: location.email,
    metadata: location.metadata ? JSON.stringify(location.metadata, null, 2) : '',
  });
  const [showTimezone, setShowTimezone] = useState(false);
  const autoFederalStateRef = useRef<string | null>(null);
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [useCitySelect, setUseCitySelect] = useState(false);
  const autoCityRef = useRef<boolean>(!location.city);
  const pendingCityRequest = useRef<AbortController | null>(null);
  const lastCityLookup = useRef<string>('');

  const scheduleState = useScheduleState(location.schedule);
  const resetDetailSchedule = scheduleState.setSchedule;

  useEffect(() => {
    const normalizedCountry = normalizeCountry(location.country);
    const defaultTimezone = getDefaultTimezone(normalizedCountry);
    const inferredState =
      resolveFederalStateByPostalCode(normalizedCountry, location.postalCode) ?? '';
    setFormValues({
      name: location.name,
      slug: location.slug,
      timezone: location.timezone,
      addressLine1: location.addressLine1,
      addressLine2: location.addressLine2,
      postalCode: location.postalCode,
      city: location.city,
      country: normalizedCountry,
      federalState: location.federalState ?? inferredState,
      phone: location.phone,
      email: location.email,
      metadata: location.metadata ? JSON.stringify(location.metadata, null, 2) : '',
    });
    setShowTimezone(location.timezone.trim() !== defaultTimezone);
    autoFederalStateRef.current = location.federalState ? null : inferredState || null;
    autoCityRef.current = !location.city;
    setCityOptions([]);
    setUseCitySelect(false);
    lastCityLookup.current = '';
    resetDetailSchedule(buildScheduleState(location.schedule));
  }, [location, resetDetailSchedule]);

  const { payload: serializedSchedule, errors: scheduleErrors } = useMemo(
    () => serializeScheduleState(scheduleState.schedule),
    [scheduleState.schedule]
  );

  const isUpdating = pending.id === location.id && pending.type === 'update';
  const isDeleting = pending.id === location.id && pending.type === 'delete';
  const disableUpdate = isDeleting || scheduleErrors.length > 0;
  const normalizedCountry = useMemo(
    () => normalizeCountry(formValues.country),
    [formValues.country]
  );
  const defaultTimezone = useMemo(
    () => getDefaultTimezone(normalizedCountry),
    [normalizedCountry]
  );
  const federalStateOptions = useMemo(
    () => getFederalStateOptions(normalizedCountry),
    [normalizedCountry]
  );
  const hasMultipleCities = cityOptions.length > 1;
  const citySelectValue =
    hasMultipleCities && useCitySelect && cityOptions.includes(formValues.city)
      ? formValues.city
      : '__manual__';
  const showCityInput = !hasMultipleCities || citySelectValue === '__manual__';

  useEffect(() => {
    const digits = formValues.postalCode.replace(/\D/g, '');
    if (digits.length < 4) {
      setCityOptions([]);
      setUseCitySelect(false);
      return;
    }

    const lookupKey = `${normalizedCountry}:${digits}`;
    if (lookupKey === lastCityLookup.current) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      pendingCityRequest.current?.abort();
      const controller = new AbortController();
      pendingCityRequest.current = controller;
      try {
        const response = await fetch(
          `/api/postal-lookup?country=${encodeURIComponent(normalizedCountry)}&postalCode=${encodeURIComponent(digits)}`,
          { signal: controller.signal }
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { city?: string | null; cities?: string[] };
        const options = Array.isArray(payload?.cities)
          ? payload.cities.filter((item) => typeof item === 'string')
          : [];
        setCityOptions(options);

        if (options.length > 1) {
          setUseCitySelect(true);
          if ((autoCityRef.current || !formValues.city) && options[0] && formValues.city !== options[0]) {
            autoCityRef.current = true;
            setFormValues((prev) => ({ ...prev, city: options[0] }));
          }
        } else {
          setUseCitySelect(false);
          if (options.length === 1 && (autoCityRef.current || !formValues.city) && formValues.city !== options[0]) {
            autoCityRef.current = true;
            setFormValues((prev) => ({ ...prev, city: options[0] }));
          }
        }
        lastCityLookup.current = lookupKey;
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('[postal-lookup] failed', error);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      pendingCityRequest.current?.abort();
    };
  }, [formValues.city, formValues.postalCode, normalizedCountry]);

  const handleSubmit = () => {
    const formData = new FormData();
    formData.set('locationId', String(location.id));
    formData.set('name', formValues.name);
    formData.set('slug', formValues.slug);
    formData.set('timezone', formValues.timezone);
    formData.set('addressLine1', formValues.addressLine1);
    formData.set('addressLine2', formValues.addressLine2);
    formData.set('postalCode', formValues.postalCode);
    formData.set('city', formValues.city);
    formData.set('country', formValues.country);
    formData.set('federalState', formValues.federalState);
    formData.set('phone', formValues.phone);
    formData.set('email', formValues.email);
    formData.set('metadata', formValues.metadata);
    formData.set('schedule', JSON.stringify(serializedSchedule));
    onUpdate(location.id, formData);
  };

  return (
    <article className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{location.name || 'Unbenannter Standort'}</h3>
          <p className="text-sm text-slate-500">
            Pflegt Stammdaten, Kontaktinfos und wöchentliche Öffnungszeiten dieses Standorts.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-brand/50"
            disabled={disableUpdate}
          >
            {isUpdating ? 'Speichern…' : 'Änderungen speichern'}
          </button>
          <button
            type="button"
            onClick={() => onDelete(location.id)}
            className="rounded-md border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isDeleting}
          >
            {isDeleting ? 'Löschen…' : 'Standort löschen'}
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          <span>Name *</span>
          <input
            value={formValues.name}
            onChange={(event) => setFormValues((prev) => ({ ...prev, name: event.target.value }))}
            disabled={isDeleting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          <span>Slug *</span>
          <input
            value={formValues.slug}
            onChange={(event) => setFormValues((prev) => ({ ...prev, slug: event.target.value }))}
            disabled={isDeleting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
            placeholder="z. B. city-center-salon"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600 md:col-span-2">
          <span>Adresse Zeile 1</span>
          <input
            value={formValues.addressLine1}
            onChange={(event) => setFormValues((prev) => ({ ...prev, addressLine1: event.target.value }))}
            disabled={isDeleting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
            placeholder="z. B. Musterstrasse 12"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600 md:col-span-2">
          <span>Adresse Zeile 2</span>
          <input
            value={formValues.addressLine2}
            onChange={(event) => setFormValues((prev) => ({ ...prev, addressLine2: event.target.value }))}
            disabled={isDeleting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
            placeholder="z. B. 2. Etage"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          <span>PLZ</span>
          <input
            value={formValues.postalCode}
            onChange={(event) => {
              const value = event.target.value;
              autoCityRef.current = true;
              setUseCitySelect(false);
              setFormValues((prev) => {
                const normalized = normalizeCountry(prev.country);
                const inferred =
                  resolveFederalStateByPostalCode(normalized, value) ?? '';
                const shouldApply =
                  inferred &&
                  (!prev.federalState || prev.federalState === autoFederalStateRef.current);
                if (shouldApply) {
                  autoFederalStateRef.current = inferred;
                  return { ...prev, postalCode: value, federalState: inferred };
                }
                return { ...prev, postalCode: value };
              });
            }}
            disabled={isDeleting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
            placeholder="z. B. 01067"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          <span>Ort</span>
          {hasMultipleCities ? (
            <select
              value={citySelectValue}
              onChange={(event) => {
                const next = event.target.value;
                if (next === '__manual__') {
                  setUseCitySelect(false);
                  autoCityRef.current = false;
                  return;
                }
                autoCityRef.current = true;
                setFormValues((prev) => ({ ...prev, city: next }));
                setUseCitySelect(true);
              }}
              disabled={isDeleting}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
            >
              <option value="__manual__">Manuell eingeben</option>
              {cityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : null}
          {showCityInput ? (
            <input
              value={formValues.city}
              onChange={(event) => {
                const next = event.target.value;
                autoCityRef.current = next.trim().length === 0;
                setUseCitySelect(false);
                setFormValues((prev) => ({ ...prev, city: next }));
              }}
              disabled={isDeleting}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
              placeholder="z. B. Dresden"
            />
          ) : null}
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          <span>Land *</span>
          <select
            value={normalizedCountry}
            onChange={(event) =>
              setFormValues((prev) => {
                const nextCountry = event.target.value;
                const normalizedNext = normalizeCountry(nextCountry);
                const prevDefaultTimezone = getDefaultTimezone(normalizeCountry(prev.country));
                const nextDefaultTimezone = getDefaultTimezone(normalizedNext);
                const nextTimezone =
                  !prev.timezone || prev.timezone === prevDefaultTimezone
                    ? nextDefaultTimezone
                    : prev.timezone;
                const options = getFederalStateOptions(normalizedNext);
                const keepState = options.some((option) => option.code === prev.federalState);
                const inferredState =
                  resolveFederalStateByPostalCode(normalizedNext, prev.postalCode) ?? '';
                const nextFederalState = keepState ? prev.federalState : inferredState;
                autoFederalStateRef.current = keepState ? autoFederalStateRef.current : inferredState || null;
                return {
                  ...prev,
                  country: normalizedNext,
                  federalState: nextFederalState,
                  timezone: nextTimezone,
                };
              })
            }
            disabled={isDeleting}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
          >
            {COUNTRY_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          <span>Bundesland (Feiertage)</span>
          <select
            value={formValues.federalState}
            onChange={(event) => {
              autoFederalStateRef.current = null;
              setFormValues((prev) => ({ ...prev, federalState: event.target.value }));
            }}
            disabled={isDeleting}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
          >
            <option value="">Nur bundesweite Feiertage</option>
            {federalStateOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-2 text-xs text-slate-600 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <span>Zeitzone automatisch: {defaultTimezone}</span>
            <button
              type="button"
              onClick={() => setShowTimezone((prev) => !prev)}
              className="text-xs font-semibold text-slate-700 hover:underline"
            >
              {showTimezone ? 'Zeitzone ausblenden' : 'Zeitzone bearbeiten'}
            </button>
          </div>
          {showTimezone ? (
            <input
              value={formValues.timezone}
              onChange={(event) => setFormValues((prev) => ({ ...prev, timezone: event.target.value }))}
              disabled={isDeleting}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
              placeholder={defaultTimezone}
            />
          ) : null}
        </div>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          <span>Telefon</span>
          <input
            value={formValues.phone}
            onChange={(event) => setFormValues((prev) => ({ ...prev, phone: event.target.value }))}
            disabled={isDeleting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
            placeholder="+49 ..."
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          <span>E-Mail</span>
          <input
            value={formValues.email}
            onChange={(event) => setFormValues((prev) => ({ ...prev, email: event.target.value }))}
            disabled={isDeleting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
            placeholder="kontakt@example.de"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600 md:col-span-2">
          <span>Metadata (optional, JSON)</span>
          <textarea
            value={formValues.metadata}
            onChange={(event) => setFormValues((prev) => ({ ...prev, metadata: event.target.value }))}
            disabled={isDeleting}
            rows={4}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed"
            placeholder='{"hinweis": "Optional"}'
          />
        </label>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-800">Öffnungszeiten</h4>
        {scheduleErrors.length ? (
          <ul className="list-disc space-y-1 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
            {scheduleErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
        <ScheduleEditor state={scheduleState} disabled={isDeleting} />
      </section>
    </article>
  );
}

const WEEKDAY_SHORT: Record<BranchWeekday, string> = {
  MONDAY: 'Mo',
  TUESDAY: 'Di',
  WEDNESDAY: 'Mi',
  THURSDAY: 'Do',
  FRIDAY: 'Fr',
  SATURDAY: 'Sa',
  SUNDAY: 'So',
};

function summarizeSchedule(schedule: BranchScheduleRule[]): string {
  const activeRules = schedule.filter(
    (rule) => rule.isActive && rule.startsAtMinutes != null && rule.endsAtMinutes != null
  );
  if (!activeRules.length) {
    return 'Keine Öffnungszeiten hinterlegt';
  }
  const activeDays = Array.from(
    new Set(activeRules.map((rule) => rule.weekday))
  ).sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
  const dayLabel = activeDays.map((day) => WEEKDAY_SHORT[day]).join(', ');
  const segmentCount = activeRules.length;
  const segmentLabel = segmentCount === 1 ? 'Zeitfenster' : 'Zeitfenster';
  return `${dayLabel} · ${segmentCount} ${segmentLabel}`;
}

function LocationList({
  locations,
  selectedId,
  onSelect,
}: {
  locations: Location[];
  selectedId: number | null;
  onSelect: (locationId: number) => void;
}) {
  if (!locations.length) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
        Es wurden noch keine Standorte angelegt.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {locations.map((location) => {
        const isSelected = location.id === selectedId;
        const summary = summarizeSchedule(location.schedule);
        return (
          <li
            key={location.id}
            className={`flex flex-col gap-3 px-4 py-4 transition sm:flex-row sm:items-center sm:justify-between ${
              isSelected ? 'bg-brand/5' : ''
            }`}
          >
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">{location.name}</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {location.slug}
                </span>
                {isSelected ? (
                  <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">Ausgewählt</span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                {location.city ? <span>{location.city}</span> : null}
                {location.postalCode ? <span>{location.postalCode}</span> : null}
                <span>Zeitzone: {location.timezone || 'n/a'}</span>
              </div>
              <p className="text-xs text-slate-500">{summary}</p>
            </div>
            <button
              type="button"
              onClick={() => onSelect(location.id)}
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
            >
              Details anzeigen
              <span aria-hidden>→</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function AdminLocationsClient({ locations, createAction, updateAction, deleteAction }: Props) {
  const router = useRouter();
  const [createState, createFormAction] = useActionState(createAction, null);
  const [feedback, setFeedback] = useState<LocationActionState>(null);
  const [pending, setPending] = useState<PendingState>({ id: null, type: null });
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(() =>
    locations.length ? locations[0].id : null
  );
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showCreateTimezone, setShowCreateTimezone] = useState(false);
  const autoCreateFederalStateRef = useRef<string | null>(null);
  const [newCityOptions, setNewCityOptions] = useState<string[]>([]);
  const [useNewCitySelect, setUseNewCitySelect] = useState(false);
  const autoCreateCityRef = useRef<boolean>(true);
  const pendingCreateCityRequest = useRef<AbortController | null>(null);
  const lastCreateCityLookup = useRef<string>('');

  const createScheduleState = useScheduleState([]);
  const resetCreateSchedule = createScheduleState.setSchedule;

  const [newLocationValues, setNewLocationValues] = useState({
    name: '',
    slug: '',
    timezone: getDefaultTimezone(normalizeCountry('DE')),
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
    city: '',
    country: 'DE',
    federalState: '',
    phone: '',
    email: '',
    metadata: '',
  });

  const { payload: createSchedulePayload, errors: createScheduleErrors } = useMemo(
    () => serializeScheduleState(createScheduleState.schedule),
    [createScheduleState.schedule]
  );
  const normalizedCreateCountry = useMemo(
    () => normalizeCountry(newLocationValues.country),
    [newLocationValues.country]
  );
  const defaultCreateTimezone = useMemo(
    () => getDefaultTimezone(normalizedCreateCountry),
    [normalizedCreateCountry]
  );
  const createFederalStateOptions = useMemo(
    () => getFederalStateOptions(normalizedCreateCountry),
    [normalizedCreateCountry]
  );
  const hasNewMultipleCities = newCityOptions.length > 1;
  const newCitySelectValue =
    hasNewMultipleCities && useNewCitySelect && newCityOptions.includes(newLocationValues.city)
      ? newLocationValues.city
      : '__manual__';
  const showNewCityInput = !hasNewMultipleCities || newCitySelectValue === '__manual__';

  useEffect(() => {
    if (createState?.status === 'success') {
      formRef.current?.reset();
      resetCreateSchedule(createEmptyScheduleState());
      setNewLocationValues({
        name: '',
        slug: '',
        timezone: getDefaultTimezone(normalizeCountry('DE')),
        addressLine1: '',
        addressLine2: '',
        postalCode: '',
        city: '',
        country: 'DE',
        federalState: '',
        phone: '',
        email: '',
        metadata: '',
      });
      setShowCreateForm(false);
      setShowCreateTimezone(false);
      autoCreateFederalStateRef.current = null;
      autoCreateCityRef.current = true;
      setNewCityOptions([]);
      setUseNewCitySelect(false);
      lastCreateCityLookup.current = '';
    }
  }, [createState?.status, resetCreateSchedule]);

  useEffect(() => {
    const digits = newLocationValues.postalCode.replace(/\D/g, '');
    if (digits.length < 4) {
      setNewCityOptions([]);
      setUseNewCitySelect(false);
      return;
    }

    const lookupKey = `${normalizedCreateCountry}:${digits}`;
    if (lookupKey === lastCreateCityLookup.current) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      pendingCreateCityRequest.current?.abort();
      const controller = new AbortController();
      pendingCreateCityRequest.current = controller;
      try {
        const response = await fetch(
          `/api/postal-lookup?country=${encodeURIComponent(normalizedCreateCountry)}&postalCode=${encodeURIComponent(digits)}`,
          { signal: controller.signal }
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { city?: string | null; cities?: string[] };
        const options = Array.isArray(payload?.cities)
          ? payload.cities.filter((item) => typeof item === 'string')
          : [];
        setNewCityOptions(options);

        if (options.length > 1) {
          setUseNewCitySelect(true);
          if ((autoCreateCityRef.current || !newLocationValues.city) && options[0] && newLocationValues.city !== options[0]) {
            autoCreateCityRef.current = true;
            setNewLocationValues((prev) => ({ ...prev, city: options[0] }));
          }
        } else {
          setUseNewCitySelect(false);
          if (options.length === 1 && (autoCreateCityRef.current || !newLocationValues.city) && newLocationValues.city !== options[0]) {
            autoCreateCityRef.current = true;
            setNewLocationValues((prev) => ({ ...prev, city: options[0] }));
          }
        }
        lastCreateCityLookup.current = lookupKey;
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('[postal-lookup] failed', error);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      pendingCreateCityRequest.current?.abort();
    };
  }, [newLocationValues.city, newLocationValues.postalCode, normalizedCreateCountry]);

  useEffect(() => {
    if (!locations.length) {
      if (selectedLocationId !== null) {
        setSelectedLocationId(null);
      }
      return;
    }
    const exists = selectedLocationId != null && locations.some((location) => location.id === selectedLocationId);
    if (!exists) {
      setSelectedLocationId(locations[0].id);
    }
  }, [locations, selectedLocationId]);

  const selectedLocation = selectedLocationId
    ? locations.find((location) => location.id === selectedLocationId) ?? null
    : null;

  const handleUpdate = (locationId: number, formData: FormData) => {
    setPending({ id: locationId, type: 'update' });
    startTransition(() => {
      updateAction(formData).then((result) => {
        setFeedback(result);
        setPending({ id: null, type: null });
        if (result?.status === 'success') {
          router.refresh();
        }
      });
    });
  };

  const handleDelete = (locationId: number) => {
    if (isPending) return;
    if (!confirm('Standort wirklich löschen?')) {
      return;
    }
    setPending({ id: locationId, type: 'delete' });
    startTransition(() => {
      const formData = new FormData();
      formData.set('locationId', String(locationId));
      deleteAction(formData).then((result) => {
        setFeedback(result);
        setPending({ id: null, type: null });
        setSelectedLocationId((current) => (current === locationId ? null : current));
        if (result?.status === 'success') {
          router.refresh();
        }
      });
    });
  };

  const infoMessages = useMemo(() => {
    const messages: LocationActionState[] = [];
    if (feedback) messages.push(feedback);
    if (createState) messages.push(createState);
    return messages;
  }, [feedback, createState]);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">Standorte</h2>
            <p className="text-sm text-slate-500">
              Übersicht über alle Standorte. Wähle einen Eintrag, um Details zu bearbeiten.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            {showCreateForm ? 'Formular schließen' : '+ Standort anlegen'}
          </button>
        </div>
        <div className="mt-5">
          <LocationList
            locations={locations}
            selectedId={selectedLocationId}
            onSelect={(id) => setSelectedLocationId(id)}
          />
        </div>
      </section>

      {showCreateForm ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Neuen Standort anlegen</h2>
          <p className="text-sm text-slate-500">
            Erfasst strukturierte Stammdaten samt Öffnungszeiten. Diese Informationen stehen Kalender und API zur
            Verfügung.
          </p>
          <form ref={formRef} action={createFormAction} className="mt-5 space-y-5">
            <input type="hidden" name="timezone" value={newLocationValues.timezone} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                <span>Name *</span>
                <input
                  name="name"
                  required
                  value={newLocationValues.name}
                  onChange={(event) =>
                    setNewLocationValues((prev) => ({
                      ...prev,
                      name: event.target.value,
                      slug: prev.slug || slugifyLocal(event.target.value),
                    }))
                  }
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                <span>Slug *</span>
                <input
                  name="slug"
                  required
                  value={newLocationValues.slug}
                  onChange={(event) =>
                    setNewLocationValues((prev) => ({
                      ...prev,
                      slug: event.target.value,
                    }))
                  }
                  placeholder="z. B. city-center-salon"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600 md:col-span-2">
                <span>Adresse Zeile 1</span>
                <input
                  name="addressLine1"
                  value={newLocationValues.addressLine1}
                  onChange={(event) =>
                    setNewLocationValues((prev) => ({
                      ...prev,
                      addressLine1: event.target.value,
                    }))
                  }
                  placeholder="z. B. Musterstrasse 12"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600 md:col-span-2">
                <span>Adresse Zeile 2</span>
                <input
                  name="addressLine2"
                  value={newLocationValues.addressLine2}
                  onChange={(event) =>
                    setNewLocationValues((prev) => ({
                      ...prev,
                      addressLine2: event.target.value,
                    }))
                  }
                  placeholder="z. B. 2. Etage"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                <span>PLZ</span>
                <input
                  name="postalCode"
                  value={newLocationValues.postalCode}
                  onChange={(event) => {
                    const value = event.target.value;
                    autoCreateCityRef.current = true;
                    setUseNewCitySelect(false);
                    setNewLocationValues((prev) => {
                      const normalized = normalizeCountry(prev.country);
                      const inferred =
                        resolveFederalStateByPostalCode(normalized, value) ?? '';
                      const shouldApply =
                        inferred &&
                        (!prev.federalState || prev.federalState === autoCreateFederalStateRef.current);
                      if (shouldApply) {
                        autoCreateFederalStateRef.current = inferred;
                        return { ...prev, postalCode: value, federalState: inferred };
                      }
                      return { ...prev, postalCode: value };
                    });
                  }}
                  placeholder="z. B. 01067"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                <span>Ort</span>
                {hasNewMultipleCities ? (
                  <select
                    value={newCitySelectValue}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next === '__manual__') {
                        setUseNewCitySelect(false);
                        autoCreateCityRef.current = false;
                        return;
                      }
                      autoCreateCityRef.current = true;
                      setUseNewCitySelect(true);
                      setNewLocationValues((prev) => ({ ...prev, city: next }));
                    }}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  >
                    <option value="__manual__">Manuell eingeben</option>
                    {newCityOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : null}
                {showNewCityInput ? (
                  <input
                    name="city"
                    value={newLocationValues.city}
                    onChange={(event) => {
                      const next = event.target.value;
                      autoCreateCityRef.current = next.trim().length === 0;
                      setUseNewCitySelect(false);
                      setNewLocationValues((prev) => ({
                        ...prev,
                        city: next,
                      }));
                    }}
                    placeholder="z. B. Dresden"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                ) : (
                  <input type="hidden" name="city" value={newLocationValues.city} />
                )}
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                <span>Land *</span>
                <select
                  name="country"
                  required
                  value={normalizedCreateCountry}
                  onChange={(event) =>
                    setNewLocationValues((prev) => {
                      const nextCountry = event.target.value;
                      const normalizedNext = normalizeCountry(nextCountry);
                      const prevDefaultTimezone = getDefaultTimezone(normalizeCountry(prev.country));
                      const nextDefaultTimezone = getDefaultTimezone(normalizedNext);
                      const nextTimezone =
                        !prev.timezone || prev.timezone === prevDefaultTimezone
                          ? nextDefaultTimezone
                          : prev.timezone;
                      const options = getFederalStateOptions(normalizedNext);
                      const keepState = options.some((option) => option.code === prev.federalState);
                      const inferredState =
                        resolveFederalStateByPostalCode(normalizedNext, prev.postalCode) ?? '';
                      const nextFederalState = keepState ? prev.federalState : inferredState;
                      autoCreateFederalStateRef.current = keepState ? autoCreateFederalStateRef.current : inferredState || null;
                      return {
                        ...prev,
                        country: normalizedNext,
                        federalState: nextFederalState,
                        timezone: nextTimezone,
                      };
                    })
                  }
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                >
                  {COUNTRY_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                <span>Bundesland (Feiertage)</span>
                <select
                  name="federalState"
                  value={newLocationValues.federalState}
                  onChange={(event) => {
                    autoCreateFederalStateRef.current = null;
                    setNewLocationValues((prev) => ({
                      ...prev,
                      federalState: event.target.value,
                    }));
                  }}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                >
                  <option value="">Nur bundesweite Feiertage</option>
                  {createFederalStateOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col gap-2 text-xs text-slate-600 md:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <span>Zeitzone automatisch: {defaultCreateTimezone}</span>
                  <button
                    type="button"
                    onClick={() => setShowCreateTimezone((prev) => !prev)}
                    className="text-xs font-semibold text-slate-700 hover:underline"
                  >
                    {showCreateTimezone ? 'Zeitzone ausblenden' : 'Zeitzone bearbeiten'}
                  </button>
                </div>
                {showCreateTimezone ? (
                  <input
                    value={newLocationValues.timezone}
                    onChange={(event) =>
                      setNewLocationValues((prev) => ({
                        ...prev,
                        timezone: event.target.value,
                      }))
                    }
                    placeholder={defaultCreateTimezone}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                ) : null}
              </div>
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                <span>Telefon</span>
                <input
                  name="phone"
                  value={newLocationValues.phone}
                  onChange={(event) =>
                    setNewLocationValues((prev) => ({
                      ...prev,
                      phone: event.target.value,
                    }))
                  }
                  placeholder="+49 ..."
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600">
                <span>E-Mail</span>
                <input
                  name="email"
                  value={newLocationValues.email}
                  onChange={(event) =>
                    setNewLocationValues((prev) => ({
                      ...prev,
                      email: event.target.value,
                    }))
                  }
                  placeholder="kontakt@example.de"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-600 md:col-span-2">
                <span>Metadata (optional, JSON)</span>
                <textarea
                  name="metadata"
                  value={newLocationValues.metadata}
                  onChange={(event) =>
                    setNewLocationValues((prev) => ({
                      ...prev,
                      metadata: event.target.value,
                    }))
                  }
                  rows={4}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  placeholder='{"hinweis": "Optional"}'
                />
              </label>
            </div>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Öffnungszeiten</h3>
              {createScheduleErrors.length ? (
                <ul className="list-disc space-y-1 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
                  {createScheduleErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              ) : null}
              <input type="hidden" name="schedule" value={JSON.stringify(createSchedulePayload)} />
              <ScheduleEditor state={createScheduleState} />
            </section>

            <button
              type="submit"
              disabled={createScheduleErrors.length > 0}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-brand/50"
            >
              {createState?.status === 'success' ? 'Standort angelegt' : 'Standort anlegen'}
            </button>
          </form>
          {createState ? (
            <p
              className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                createState.status === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}
            >
              {createState.message}
            </p>
          ) : null}
        </section>
      ) : null}

      {infoMessages.length ? (
        <div className="space-y-2">
          {infoMessages.map((message, index) => (
            <p
              key={`${message?.status}-${message?.message}-${index}`}
              className={`rounded-md border px-3 py-2 text-sm ${
                message?.status === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}
            >
              {message?.message}
            </p>
          ))}
        </div>
      ) : null}

      {selectedLocation ? (
        <LocationDetailPanel
          key={selectedLocation.id}
          location={selectedLocation}
          pending={pending}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      ) : (
        <section className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
          Bitte einen Standort in der Liste auswählen, um die Details zu bearbeiten.
        </section>
      )}
    </div>
  );
}

function slugifyLocal(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}
