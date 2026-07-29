import * as React from "react";

import { useChartTokens } from "~/lib/chartTokens";
import { cn } from "~/lib/utils";
import { getPowerZoneIndex } from "~/sensors/types";

/**
 * A workout profile as bare SVG rects — no charting library.
 *
 * The library page renders one of these per card, and mounting
 * `@mui/x-charts` a dozen times to draw a dozen fixed bars would cost far more
 * than the whole rest of the page (compare the `next/dynamic` note in
 * `MetricCard.tsx`). `preserveAspectRatio="none"` lets a fixed 0–100 viewBox
 * stretch to whatever width the card ends up at.
 */

interface WorkoutMiniPreviewProps {
  /** `[durationSeconds, %FTP]` per step; null %FTP where the workout is free. */
  profile: readonly (readonly [number, number | null])[];
  /** Ceiling of the y axis in %FTP. Defaults to the profile's own peak. */
  peak?: number;
  className?: string;
}

const VIEW_HEIGHT = 30;
/** Headroom above the tallest bar so it does not touch the top edge. */
const PEAK_HEADROOM = 1.1;
/** Below this the axis stops shrinking, so easy rides don't look like intervals. */
const MIN_PEAK_PCT = 1.2;
/** A step this thin would vanish; better a hairline than a gap in the shape. */
const MIN_BAR_WIDTH = 0.25;

export function WorkoutMiniPreview({
  profile,
  peak,
  className,
}: WorkoutMiniPreviewProps) {
  const tokens = useChartTokens();

  const bars = React.useMemo(() => {
    const total = profile.reduce((sum, [duration]) => sum + duration, 0);
    if (total <= 0) return [];

    const observedPeak = profile.reduce<number>(
      (max, [, pct]) => (pct == null ? max : Math.max(max, pct)),
      0,
    );
    const ceiling =
      Math.max(peak ?? observedPeak, MIN_PEAK_PCT) * PEAK_HEADROOM;

    /**
     * Adjacent bars that would draw identically are merged. Abutting rects put
     * every edge on a fractional device pixel once the viewBox is stretched,
     * and antialiasing renders each boundary as a lighter hairline — a flat
     * block came out striped. Merging leaves a boundary only where the profile
     * actually changes.
     */
    const runs: {
      key: number;
      x: number;
      width: number;
      y: number;
      height: number;
      fill: string;
    }[] = [];

    let cursor = 0;
    profile.forEach(([duration, pct], index) => {
      const height =
        pct == null ? 2 : Math.max(1, (pct / ceiling) * VIEW_HEIGHT);
      // Zone lookup is scale-free, so asking in %FTP against an FTP of 1 is
      // the same question as asking in watts against the real FTP.
      const fill =
        pct == null ? tokens.grid.hex : tokens.zones[getPowerZoneIndex(pct, 1)];

      const x = (cursor / total) * 100;
      const width = (duration / total) * 100;
      cursor += duration;

      const last = runs[runs.length - 1];
      if (last?.fill === fill && last.height === height) {
        last.width += width;
        return;
      }
      runs.push({
        key: index,
        x,
        width: Math.max(MIN_BAR_WIDTH, width),
        y: VIEW_HEIGHT - height,
        height,
        fill,
      });
    });

    return runs;
  }, [profile, peak, tokens]);

  if (bars.length === 0) return null;

  return (
    <svg
      viewBox={`0 0 100 ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("h-full w-full", className)}
    >
      {bars.map((bar) => (
        <rect
          key={bar.key}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          fill={bar.fill}
        />
      ))}
    </svg>
  );
}
