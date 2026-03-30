'use client';

import { useLayoutEffect, useState } from 'react';

import { SHIFT_PLAN_OPEN_TEMPLATE_MODAL_EVENT } from './TemplateManager';

type TemplateHintPopupProps = {
  visible: boolean;
};

export default function TemplateHintPopup({ visible }: TemplateHintPopupProps) {
  const [open, setOpen] = useState(false);
  const [okVisible, setOkVisible] = useState(false);

  useLayoutEffect(() => {
    if (!visible) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setOkVisible(false);
    const timer = globalThis.setTimeout(() => setOkVisible(true), 1200);
    return () => globalThis.clearTimeout(timer);
  }, [visible]);

  const close = () => setOpen(false);

  const openTemplates = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(SHIFT_PLAN_OPEN_TEMPLATE_MODAL_EVENT));
    }
    close();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Hinweis</h2>
        <p className="mt-2 text-sm text-slate-700">
          Für ein schnelles Erstellen deines Schichtplan, kannst Du Vorlagen erstellen.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={openTemplates}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Vorlage erstellen
          </button>
          {okVisible ? (
            <button
              type="button"
              onClick={close}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              OK
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
