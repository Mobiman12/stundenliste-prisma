'use client';

import { Plus } from 'lucide-react';

import { SHIFT_PLAN_OPEN_TEMPLATE_MODAL_EVENT } from './TemplateManager';

export default function CreateTemplateButton() {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new Event(SHIFT_PLAN_OPEN_TEMPLATE_MODAL_EVENT));
      }}
      className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-300"
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      Neue Vorlage
    </button>
  );
}

