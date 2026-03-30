"use client";

import { useEffect, useMemo, useState } from "react";

type DebugEntry = {
  id: string;
  type: "error" | "rejection" | "console";
  message: string;
  stack?: string | null;
  time: string;
};

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export function DebugOverlay({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DebugEntry[]>([]);

  const count = items.length;
  const hasItems = count > 0;
  const latest = useMemo(() => items[0], [items]);

  useEffect(() => {
    if (!enabled) return;

    const addEntry = (entry: Omit<DebugEntry, "id" | "time">) => {
      const time = new Date().toISOString();
      const id = `${time}-${Math.random().toString(16).slice(2)}`;
      setItems((prev) => [{ ...entry, id, time }, ...prev].slice(0, 50));
    };

    const onError = (event: ErrorEvent) => {
      addEntry({
        type: "error",
        message: event.message || "Unbekannter Fehler",
        stack: event.error?.stack ?? null,
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      addEntry({
        type: "rejection",
        message: formatArg(reason),
        stack: reason instanceof Error ? reason.stack : null,
      });
    };

    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      addEntry({
        type: "console",
        message: args.map(formatArg).join(" "),
        stack: null,
      });
      originalConsoleError(...args);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      console.error = originalConsoleError;
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[9999] text-xs">
      <button
        type="button"
        className="relative flex h-12 w-12 items-center justify-center rounded-full border border-black/20 bg-neutral-900 text-sm font-semibold text-white shadow-lg transition hover:bg-neutral-800"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label="Debug Tools"
        title="Debug Tools"
      >
        N
        {hasItems ? (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="mt-2 w-[360px] max-h-[50vh] overflow-auto rounded-xl border border-black/10 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold">Fehlerübersicht</div>
            <button
              type="button"
              className="text-gray-500 hover:text-gray-900"
              onClick={() => setItems([])}
            >
              Clear
            </button>
          </div>
          {!hasItems ? (
            <div className="text-gray-500">Keine Fehler erfasst.</div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="rounded-md bg-gray-50 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{item.type}</span>
                    <span className="text-[10px] text-gray-500">
                      {new Date(item.time).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="mt-1 break-words text-gray-800">{item.message}</div>
                  {item.stack ? (
                    <pre className="mt-1 whitespace-pre-wrap text-[10px] text-gray-500">
                      {item.stack}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {latest && !hasItems ? null : latest ? (
            <div className="mt-3 text-[10px] text-gray-400">
              Letzter Fehler: {latest.message}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
