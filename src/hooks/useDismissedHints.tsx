"use client";

import * as React from "react";

const STORAGE_KEY = "undertrained:dismissed-hints";

function readFromStorage(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // Corrupted data — start fresh
  }
  return new Set();
}

function writeToStorage(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

// Back the dismissed-hints set with an external store so it can be read
// SSR-safely via useSyncExternalStore (no setState-in-effect for hydration).
const EMPTY_SET: ReadonlySet<string> = new Set();
let snapshot: ReadonlySet<string> | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): ReadonlySet<string> {
  snapshot ??= readFromStorage();
  return snapshot;
}

function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY_SET;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function updateSnapshot(next: Set<string>) {
  snapshot = next;
  writeToStorage(next);
  listeners.forEach((listener) => listener());
}

interface DismissedHintsContextValue {
  isDismissed: (id: string) => boolean;
  dismiss: (id: string) => void;
  resetAll: () => void;
}

const DismissedHintsContext = React.createContext<DismissedHintsContextValue>({
  isDismissed: () => false,
  dismiss: () => {
    /* no-op default; real implementation provided by the provider */
  },
  resetAll: () => {
    /* no-op default; real implementation provided by the provider */
  },
});

export function DismissedHintsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const dismissed = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const isDismissed = React.useCallback(
    (id: string) => dismissed.has(id),
    [dismissed],
  );

  const dismiss = React.useCallback((id: string) => {
    const next = new Set(getSnapshot());
    next.add(id);
    updateSnapshot(next);
  }, []);

  const resetAll = React.useCallback(() => {
    updateSnapshot(new Set());
  }, []);

  const value = React.useMemo(
    () => ({ isDismissed, dismiss, resetAll }),
    [isDismissed, dismiss, resetAll],
  );

  return (
    <DismissedHintsContext value={value}>{children}</DismissedHintsContext>
  );
}

export function useDismissedHints(): DismissedHintsContextValue {
  return React.useContext(DismissedHintsContext);
}
