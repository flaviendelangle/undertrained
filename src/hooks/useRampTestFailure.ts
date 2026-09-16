import { useEffect, useRef } from "react";

import type { TrainerData } from "~/sensors/types";

/** Zwift documents stopping pedaling, but not its exact detection timeout.
 * Use ten seconds of measured zero power, never a brief dip or missing data. */
const STOPPED_SECONDS = 10;
const STALE_AFTER_MS = 2500;

export function useRampTestFailure({
  active,
  data,
  elapsedSeconds,
  onFailure,
}: {
  active: boolean;
  data: TrainerData | null;
  elapsedSeconds: number;
  onFailure?: () => void;
}) {
  const lastData = useRef<{ data: TrainerData | null; at: number }>({
    data: null,
    at: 0,
  });
  const zeroSince = useRef<number | null>(null);
  const lastCheckAt = useRef<number | null>(null);
  const hasPedaled = useRef(false);
  useEffect(() => {
    const now = performance.now();
    // A suspended tab is not ten seconds of observed zero-power samples.
    if (
      lastCheckAt.current != null &&
      now - lastCheckAt.current > STALE_AFTER_MS
    )
      zeroSince.current = null;
    lastCheckAt.current = now;
    if (data !== lastData.current.data) lastData.current = { data, at: now };
    if (!active) {
      zeroSince.current = null;
      hasPedaled.current = false;
      return;
    }
    const power = data?.power;
    const stale = now - lastData.current.at > STALE_AFTER_MS;
    if (stale || power == null || !Number.isFinite(power) || power < 0) {
      zeroSince.current = null;
      return;
    }
    if (power > 0 || (data?.cadence ?? 0) > 0) {
      hasPedaled.current = true;
      zeroSince.current = null;
      return;
    }
    if (!hasPedaled.current) return;
    zeroSince.current ??= elapsedSeconds;
    const seconds = Math.max(
      0,
      STOPPED_SECONDS - (elapsedSeconds - zeroSince.current),
    );
    if (seconds === 0) {
      zeroSince.current = null;
      hasPedaled.current = false;
      onFailure?.();
    }
  }, [active, data, elapsedSeconds, onFailure]);
}
