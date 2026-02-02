'use client';

import { useEffect } from 'react';

export type RefreshableActionState =
  | {
      status: 'success' | 'error';
      message?: string;
    }
  | null;

export function useActionRefresh(state: RefreshableActionState, refresh: () => void) {
  useEffect(() => {
    if (state?.status === 'success') {
      refresh();
    }
  }, [state, refresh]);
}
