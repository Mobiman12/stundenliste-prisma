'use client';

import { useLayoutEffect, useMemo, useState } from 'react';

type MissingShiftPlanPopupProps = {
  /**
   * Stable key for dismissal. Example: "2026-03".
   */
  missingMonthKey: string;
  /**
   * Scope for dismissal so different employees (or tenants) do not affect each other.
   * Example: "cmj8...:42".
   */
  dismissScopeKey: string;
  /**
   * German month label shown to the employee. Example: "Maerz 2026".
   */
  missingMonthLabel: string;
  /**
   * Link destination to create the shift plan.
   */
  shiftPlanHref: string;
  /**
   * If true, the employee is allowed to manage their own shift plan.
   * Only then we show the self-service link text.
   */
  allowEmployeeSelfPlan: boolean;
};

const storageKey = (scopeKey: string, monthKey: string) => `timeshift_missing_shiftplan_dismissed:${scopeKey}:${monthKey}`;

export function MissingShiftPlanPopup(props: MissingShiftPlanPopupProps) {
  const dismissKey = useMemo(
    () => storageKey(props.dismissScopeKey, props.missingMonthKey),
    [props.dismissScopeKey, props.missingMonthKey],
  );
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [okVisible, setOkVisible] = useState(false);

  useLayoutEffect(() => {
    let shouldOpen = true;
    try {
      const dismissed = globalThis.sessionStorage?.getItem(dismissKey);
      if (dismissed === '1') {
        shouldOpen = false;
      }
    } catch {
      // ignore storage errors (private mode etc.)
    }

    setHydrated(true);
    setOpen(shouldOpen);

    if (!shouldOpen) {
      return;
    }

    setOkVisible(false);
    const timer = globalThis.setTimeout(() => setOkVisible(true), 5000);
    return () => globalThis.clearTimeout(timer);
  }, [dismissKey]);

  const close = () => {
    try {
      globalThis.sessionStorage?.setItem(dismissKey, '1');
    } catch {
      // ignore
    }
    setOpen(false);
  };

  const jumpToShiftPlan = () => {
    close();
    if (props.shiftPlanHref) {
      globalThis.location.href = props.shiftPlanHref;
    }
  };

  if (!hydrated) return null;
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Hinweis</h2>
          <p className="text-sm text-slate-700">
            Dein Schichtplan wurde für den Monat <span className="font-semibold">{props.missingMonthLabel}</span> und
            folgende noch nicht angelegt. Es können somit keine Schichtzeiten oder Umsätze (wenn aktiviert) automatisch
            eingefügt werden. Bitte wende dich an den Admin.
          </p>

          {props.allowEmployeeSelfPlan ? (
            <p className="text-sm text-slate-700">
              Oder lege jetzt Deinen Schichtplan an:{' '}
              <a
                href={props.shiftPlanHref}
                className="font-semibold text-brand underline underline-offset-2"
                onClick={() => close()}
              >
                {props.shiftPlanHref}
              </a>
              .
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end">
          {okVisible ? (
            <button
              type="button"
              onClick={jumpToShiftPlan}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              OK
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
