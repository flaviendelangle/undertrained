import * as React from "react";

/**
 * Shared crosshair geometry + SVG pieces for the custom WebGL charts
 * (ActivityStreams, PowerCurve). Both draw the hovered position the same way —
 * a dashed vertical line plus a ringed dot at each series — so the "you are
 * here" indicator reads identically across charts (and matches the Map's
 * highlight marker, which reuses the same fill/ring treatment).
 */
export const CROSSHAIR = {
  /** Dash pattern for the vertical line. */
  dash: "3,3",
  /** Vertical line stroke width. */
  width: 1,
  /** Series dot radius. */
  dotRadius: 3.5,
  /** Series dot ring (stroke) width. */
  dotStroke: 1.5,
} as const;

/** The dashed vertical line at the hovered x, from the top of the plot down. */
export function CrosshairLine({
  x,
  height,
  color,
}: {
  x: number;
  height: number;
  color: string;
}) {
  return (
    <line
      x1={x}
      y1={0}
      x2={x}
      y2={height}
      stroke={color}
      strokeWidth={CROSSHAIR.width}
      strokeDasharray={CROSSHAIR.dash}
      pointerEvents="none"
    />
  );
}

/** A series dot at the crosshair: series-colored fill, card-colored ring. */
export function CrosshairDot({
  cx,
  cy,
  color,
  ringColor,
}: {
  cx: number;
  cy: number;
  color: string;
  ringColor: string;
}) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={CROSSHAIR.dotRadius}
      fill={color}
      stroke={ringColor}
      strokeWidth={CROSSHAIR.dotStroke}
      pointerEvents="none"
    />
  );
}
