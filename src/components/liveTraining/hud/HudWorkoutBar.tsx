import * as React from "react";

import { useChartTokens } from "~/lib/chartTokens";
import { cn } from "~/lib/utils";
import type { ResolvedSegment } from "~/utils/structuredWorkout";

/**
 * The whole workout profile with a playhead.
 *
 * Deliberately hand-rolled SVG rather than a chart: this repaints every second
 * for the length of a ride, and `PowerHrChart` is already the HUD's main source
 * of jank (see its `CHART_REFRESH_TICKS` note). The rect list is memoized, so a
 * tick moves one `<line>` and nothing else.
 *
 * With `progressPct` omitted it renders static, which is how the waiting screen
 * and the picker show a thumbnail.
 */

const VIEW_HEIGHT = 100;
/** Headroom so a 150 % spike doesn't clip at the top edge. */
const PEAK_HEADROOM = 1.1;
const MIN_PEAK_PCT = 1.2;

interface HudWorkoutBarProps {
  segments: readonly ResolvedSegment[];
  /** 0..1. Omit for a static thumbnail with no playhead. */
  progressPct?: number;
  className?: string;
}

export function HudWorkoutBar({
  segments,
  progressPct,
  className,
}: HudWorkoutBarProps) {
  const tokens = useChartTokens();

  const totalSeconds =
    segments.length === 0 ? 0 : segments[segments.length - 1].endSeconds;

  const shapes = React.useMemo(() => {
    if (totalSeconds <= 0) return [];
    const peak = segments.reduce(
      (max, segment) =>
        Math.max(max, segment.startPct ?? 0, segment.endPct ?? 0),
      0,
    );
    const ceiling = Math.max(peak, MIN_PEAK_PCT) * PEAK_HEADROOM;
    const scaleX = (seconds: number) => (seconds / totalSeconds) * 100;
    const scaleY = (pct: number) => VIEW_HEIGHT - (pct / ceiling) * VIEW_HEIGHT;

    return segments.map((segment) => {
      const x1 = scaleX(segment.startSeconds);
      const x2 = scaleX(segment.endSeconds);
      const fill =
        segment.startPct == null
          ? tokens.grid.hex
          : tokens.zones[segment.zoneIndex];

      if (segment.startPct == null || segment.endPct == null) {
        return {
          key: segment.index,
          points: null,
          x: x1,
          width: x2 - x1,
          y: scaleY(0.35),
          height: VIEW_HEIGHT - scaleY(0.35),
          fill,
          opacity: 0.4,
        };
      }

      if (segment.isRamp) {
        return {
          key: segment.index,
          points: `${x1},${VIEW_HEIGHT} ${x1},${scaleY(segment.startPct)} ${x2},${scaleY(segment.endPct)} ${x2},${VIEW_HEIGHT}`,
          fill,
          opacity: 1,
        };
      }

      const y = scaleY(segment.startPct);
      return {
        key: segment.index,
        points: null,
        x: x1,
        // A hairline overlap hides antialiasing seams between adjacent bars.
        width: x2 - x1 + 0.05,
        y,
        height: VIEW_HEIGHT - y,
        fill,
        opacity: 1,
      };
    });
  }, [segments, totalSeconds, tokens]);

  if (shapes.length === 0) return null;

  const playheadX = progressPct == null ? null : progressPct * 100;

  return (
    <svg
      viewBox={`0 0 100 ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("h-full w-full", className)}
    >
      {shapes.map((shape) =>
        shape.points != null ? (
          <polygon
            key={shape.key}
            points={shape.points}
            fill={shape.fill}
            opacity={shape.opacity}
          />
        ) : (
          <rect
            key={shape.key}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            fill={shape.fill}
            opacity={shape.opacity}
          />
        ),
      )}

      {playheadX != null && (
        <>
          {/* Everything already ridden dims, so "how far in am I" is readable
              at a glance from the bike. */}
          <rect
            x={0}
            y={0}
            width={playheadX}
            height={VIEW_HEIGHT}
            fill={tokens.cardBg}
            opacity={0.55}
          />
          <line
            x1={playheadX}
            y1={0}
            x2={playheadX}
            y2={VIEW_HEIGHT}
            stroke={tokens.accent}
            strokeWidth={0.6}
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  );
}
