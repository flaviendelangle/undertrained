"use client";

import * as React from "react";

import { clamp } from "@base-ui/utils/clamp";

export interface SliceWidthStore {
  min: number;
  max: number;
  /**
   * Round and clamp a width to the [min, max] bounds — the single source of
   * truth for slice-width bounds, applied on the initial storage read and at
   * the point of use, never on the stored value.
   */
  clampSliceWidth: (value: number) => number;
  useSliceWidth: () => [number, (next: number) => void];
}

/**
 * The width of each bar in a Distribution histogram, persisted to localStorage
 * so the preferred granularity sticks across activities and sessions. Backed by
 * an external store read through `useSyncExternalStore` (SSR-safe, and kept in
 * sync across every instance) — the same pattern as `useDismissedHints`.
 */
export function createSliceWidthStore({
  storageKey,
  defaultWidth,
  min,
  max,
}: {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
}): SliceWidthStore {
  const clampSliceWidth = (value: number) => clamp(Math.round(value), min, max);

  function readFromStorage(): number {
    if (typeof window === "undefined") return defaultWidth;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) return clampSliceWidth(parsed);
      }
    } catch {
      // Unavailable or corrupted storage — fall back to the default.
    }
    return defaultWidth;
  }

  let snapshot: number | null = null;
  const listeners = new Set<() => void>();

  function getSnapshot(): number {
    snapshot ??= readFromStorage();
    return snapshot;
  }

  function getServerSnapshot(): number {
    return defaultWidth;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function setSliceWidth(next: number) {
    // Store the raw value so a controlled NumberField doesn't fight mid-typing
    // (e.g. "1" on the way to "10"). Bounds are applied by clampSliceWidth at
    // the point of use, not here. Ignore non-finite input (a cleared field).
    if (!Number.isFinite(next)) return;
    snapshot = next;
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // Best-effort persistence — keep the in-memory value either way.
    }
    listeners.forEach((listener) => listener());
  }

  function useSliceWidth(): [number, (next: number) => void] {
    const sliceWidth = React.useSyncExternalStore(
      subscribe,
      getSnapshot,
      getServerSnapshot,
    );
    return [sliceWidth, setSliceWidth];
  }

  return { min, max, clampSliceWidth, useSliceWidth };
}
