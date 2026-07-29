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
  /** Evenly spaced %FTP samples; null where the workout is free-riding. */
  profile: readonly (number | null)[];
  /** Ceiling of the y axis in %FTP. Defaults to the profile's own peak. */
  peak?: number;
  className?: string;
}

const VIEW_HEIGHT = 30;
/** Headroom above the tallest bar so it does not touch the top edge. */
const PEAK_HEADROOM = 1.1;
/** Below this the axis stops shrinking, so easy rides don't look like intervals. */
const MIN_PEAK_PCT = 1.2;

export function WorkoutMiniPreview({
  profile,
  peak,
  className,
}: WorkoutMiniPreviewProps) {
  const tokens = useChartTokens();

  const bars = React.useMemo(() => {
    if (profile.length === 0) return [];

    const observedPeak = profile.reduce<number>(
      (max, value) => (value == null ? max : Math.max(max, value)),
      0,
    );
    const ceiling =
      Math.max(peak ?? observedPeak, MIN_PEAK_PCT) * PEAK_HEADROOM;
    const width = 100 / profile.length;

    return profile.map((value, index) => {
      const height =
        value == null ? 2 : Math.max(1, (value / ceiling) * VIEW_HEIGHT);
      return {
        key: index,
        x: index * width,
        width,
        y: VIEW_HEIGHT - height,
        height,
        // Zone lookup is scale-free, so asking in %FTP against an FTP of 1 is
        // the same question as asking in watts against the real FTP.
        fill:
          value == null
            ? tokens.grid.hex
            : tokens.zones[getPowerZoneIndex(value, 1)],
      };
    });
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
          // A hairline overlap hides the seams antialiasing leaves between
          // adjacent bars of the same colour.
          width={bar.width + 0.05}
          height={bar.height}
          fill={bar.fill}
        />
      ))}
    </svg>
  );
}
