'use client';

import { useEffect, useRef, useState } from 'react';

import { withAppBasePath } from '@/lib/routes';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const REFRESH_THROTTLE_MS = 60 * 1000;
const WARNING_WINDOW_MS = 30 * 1000;

type EmployeeIdleLogoutProps = {
  timeoutMs?: number;
  mode?: 'employee' | 'admin';
};

export function EmployeeIdleLogout({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  mode = 'employee',
}: EmployeeIdleLogoutProps) {
  const timeoutRef = useRef<number | null>(null);
  const warningTimeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const logoutAtRef = useRef(0);
  const lastRefreshAtRef = useRef(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    const logoutUrl = withAppBasePath(`/api/auth/logout?mode=${mode}`, 'external');
    const refreshUrl = withAppBasePath(`/api/auth/session/refresh?mode=${mode}`, 'external');

    const refreshSession = () => {
      const now = Date.now();
      if (now - lastRefreshAtRef.current < REFRESH_THROTTLE_MS) {
        return;
      }
      lastRefreshAtRef.current = now;
      void fetch(refreshUrl, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        keepalive: true,
      }).catch(() => {
        // Ignore network hiccups; inactivity timer is still enforced locally.
      });
    };

    const clearWarningTimers = () => {
      if (warningTimeoutRef.current) {
        window.clearTimeout(warningTimeoutRef.current);
        warningTimeoutRef.current = null;
      }
      if (countdownIntervalRef.current) {
        window.clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((logoutAtRef.current - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0 && countdownIntervalRef.current) {
        window.clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };

    const startWarningCountdown = () => {
      setShowWarning(true);
      updateCountdown();
      if (countdownIntervalRef.current) {
        window.clearInterval(countdownIntervalRef.current);
      }
      countdownIntervalRef.current = window.setInterval(updateCountdown, 1000);
    };

    const scheduleLogout = () => {
      refreshSession();
      setShowWarning(false);
      setSecondsLeft(0);
      clearWarningTimers();

      logoutAtRef.current = Date.now() + timeoutMs;
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      const warningDelay = Math.max(timeoutMs - WARNING_WINDOW_MS, 0);
      warningTimeoutRef.current = window.setTimeout(startWarningCountdown, warningDelay);
      timeoutRef.current = window.setTimeout(() => {
        window.location.assign(logoutUrl);
      }, timeoutMs);
    };

    const events: (keyof WindowEventMap)[] = [
      'click',
      'touchstart',
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
      clearWarningTimers();
      for (const eventName of events) {
        window.removeEventListener(eventName, scheduleLogout, listenerOptions);
      }
    };
  }, [mode, timeoutMs]);

  if (!showWarning) {
    return null;
  }

  return (
    <div className="fixed right-4 top-4 z-[120] w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 shadow-lg">
      <p className="text-sm font-semibold text-amber-900">Automatischer Logout</p>
      <p className="mt-1 text-sm text-amber-800">
        In {secondsLeft} Sekunden wirst du wegen Inaktivität abgemeldet.
      </p>
    </div>
  );
}
