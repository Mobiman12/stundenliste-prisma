'use client';

import { useEffect, useRef } from 'react';

import { withAppBasePath } from '@/lib/routes';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

type EmployeeIdleLogoutProps = {
  timeoutMs?: number;
};

export function EmployeeIdleLogout({ timeoutMs = DEFAULT_TIMEOUT_MS }: EmployeeIdleLogoutProps) {
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const logoutUrl = withAppBasePath('/api/auth/logout?mode=employee', 'external');

    const scheduleLogout = () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => {
        window.location.assign(logoutUrl);
      }, timeoutMs);
    };

    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'focus',
    ];

    const listenerOptions: AddEventListenerOptions = { passive: true };
    for (const eventName of events) {
      window.addEventListener(eventName, scheduleLogout, listenerOptions);
    }

    scheduleLogout();

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      for (const eventName of events) {
        window.removeEventListener(eventName, scheduleLogout, listenerOptions);
      }
    };
  }, [timeoutMs]);

  return null;
}
