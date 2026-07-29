import { useXScale, useYScale } from "@mui/x-charts-pro";

import { useChartTokens } from "~/lib/chartTokens";

/**
 * Bracket overlay for interval structure: one recessive ⌐———————¬ marker per
 * block, drawn in the headroom above the plot with its label centered on top.
 *
 * Shared by the Laps chart (where the structure was *detected* from a ride, and
 * a low-confidence detection is drawn dashed) and the workout builder's preview
 * (where it was authored, and nested repeats stack by `row`). The label
 * degradation — full → short → none, by measured width — is the fiddly part and
 * is why this lives in one place.
 */

export interface StructureAnnotation {
  start: number;
  end: number;
  /** e.g. "10 × 1:00 @ 280 W" or "2 × 5 × 3:00 @ 4:30 /km". */
  label: string;
  /** Fallback when the bracket is too narrow, e.g. "10 × 1:00". */
  shortLabel: string;
  /** Stack level; 0 sits closest to the top of the plot. Defaults to 0. */
  row?: number;
}

/** Rough glyph width at font-size 11 — only used to pick a label that fits. */
const CHAR_WIDTH = 6.2;
/** Below this a bracket is too narrow to read as anything but noise. */
const MIN_BRACKET_PX = 12;
const TICK_HEIGHT = 5;
const ROW_HEIGHT = 18;

interface StructureBracketsProps {
  annotations: readonly StructureAnnotation[];
  /** Draw the brackets dashed — used for a low-confidence detection. */
  dashed?: boolean;
  xAxisId: string;
  yAxisId: string;
  /** Gap trimmed off the right edge so a bracket aligns with its last bar. */
  gapPx?: number;
}

export function StructureBrackets({
  annotations,
  dashed = false,
  xAxisId,
  yAxisId,
  gapPx = 0,
}: StructureBracketsProps) {
  const tokens = useChartTokens();
  const xScale = useXScale<"linear">(xAxisId);
  const yScale = useYScale<"linear">(yAxisId);

  const plotTop = Math.min(...yScale.range());

  return (
    <g pointerEvents="none">
      {annotations.map((annotation, index) => {
        const row = annotation.row ?? 0;
        const labelBaselineY = plotTop + 14 + row * ROW_HEIGHT;
        const bracketY = plotTop + 20 + row * ROW_HEIGHT;

        const x1 = xScale(annotation.start);
        const x2 = xScale(annotation.end) - gapPx;
        const width = x2 - x1;
        if (width < MIN_BRACKET_PX) return null;

        const label =
          width >= annotation.label.length * CHAR_WIDTH + 8
            ? annotation.label
            : width >= annotation.shortLabel.length * CHAR_WIDTH + 8
              ? annotation.shortLabel
              : null;

        return (
          <g key={`${annotation.start}-${row}-${index}`}>
            <path
              d={`M ${x1} ${bracketY + TICK_HEIGHT} V ${bracketY} H ${x2} V ${bracketY + TICK_HEIGHT}`}
              fill="none"
              stroke={tokens.axisLabel}
              strokeDasharray={dashed ? "3 3" : undefined}
            />
            {label != null && (
              <text
                x={(x1 + x2) / 2}
                y={labelBaselineY}
                textAnchor="middle"
                fill={tokens.axisLabel}
                fontSize={11}
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
