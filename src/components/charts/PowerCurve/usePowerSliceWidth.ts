"use client";

import * as React from "react";

/**
 * The width (in watts) of each bar in the Power → Distribution histogram,
 * persisted to localStorage so a rider's preferred granularity sticks across
 * activities and sessions. Backed by an external store read through
 * `useSyncExternalStore` (SSR-safe, and kept in sync across every instance) —
 * the same pattern as `useDismissedHints`.
 */
const STORAGE_KEY = "undertrained:power-slice-width";

export const DEFAULT_SLICE_WIDTH = 25;
export const MIN_SLICE_WIDTH = 5;
export const MAX_SLICE_WIDTH = 200;

/**
 * Round and clamp a width to the [MIN, MAX] bounds — the single source of truth
 * for slice-width bounds, applied on the initial storage read and at the point
 * of use (see PowerCurve), never on the stored value.
 */
export function clampSliceWidth(value: number): number {
  return Math.min(
    MAX_SLICE_WIDTH,
    Math.max(MIN_SLICE_WIDTH, Math.round(value)),
  );
}

function readFromStorage(): number {
  if (typeof window === "undefined") return DEFAULT_SLICE_WIDTH;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw != null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return clampSliceWidth(parsed);
    }
  } catch {
    // Unavailable or corrupted storage — fall back to the default.
  }
  return DEFAULT_SLICE_WIDTH;
}

let snapshot: number | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): number {
  snapshot ??= readFromStorage();
  return snapshot;
}

function getServerSnapshot(): number {
  return DEFAULT_SLICE_WIDTH;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setSliceWidth(next: number) {
  // Store the raw value so a controlled NumberField doesn't fight mid-typing
  // (e.g. "1" on the way to "10"). Bounds are applied by clampSliceWidth at the
  // point of use, not here. Ignore non-finite input (a cleared field).
  if (!Number.isFinite(next)) return;
  snapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // Best-effort persistence — keep the in-memory value either way.
  }
  listeners.forEach((listener) => listener());
}

export function usePowerSliceWidth(): [number, (next: number) => void] {
  const sliceWidth = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return [sliceWidth, setSliceWidth];
}
