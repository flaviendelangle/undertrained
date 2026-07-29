import * as React from "react";

import {
  BarPlot,
  ChartsContainerPro,
  ChartsXAxis,
  ChartsYAxis,
  LinePlot,
} from "@mui/x-charts-pro";

import { CHART_MARGINS, useChartTokens } from "~/lib/chartTokens";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useT } from "~/i18n/useT";
import type { SessionDataPoint } from "~/sensors/types";
import { findPowerZone } from "~/sensors/types";

import { ChartThemeProvider } from "../charts/ChartThemeProvider";

const WINDOW_SECONDS = 600; // 10 minutes

/**
 * Upper bound on rendered bars. A full-session view is one sample per second,
 * so an hour would be 3600 bars — enough to drop frames on the kind of laptop
 * that sits on the handlebars. Longer sessions are bucket-averaged down to
 * this many points, which is well beyond the pixel width of the strip anyway.
 */
const MAX_RENDERED_POINTS = WINDOW_SECONDS;

/** Padding around the observed heart rate range, in bpm. */
const HR_AXIS_PADDING = 10;

/**
 * Averages `points` down to at most `maxPoints` buckets, preserving nulls: a
 * bucket with no reading stays null rather than becoming a zero.
 */
function downsample(
  points: SessionDataPoint[],
  maxPoints: number,
): SessionDataPoint[] {
  if (points.length <= maxPoints) return points;

  const bucketSize = Math.ceil(points.length / maxPoints);
  const result: SessionDataPoint[] = [];

  for (let start = 0; start < points.length; start += bucketSize) {
    const bucket = points.slice(start, start + bucketSize);
    const mean = (pick: (p: SessionDataPoint) => number | null) => {
      let sum = 0;
      let count = 0;
      for (const p of bucket) {
        const value = pick(p);
        if (value != null) {
          sum += value;
          count++;
        }
      }
      return count > 0 ? sum / count : null;
    };
    const last = bucket[bucket.length - 1];
    result.push({
      timestamp: last.timestamp,
      elapsed: last.elapsed,
      distance: last.distance,
      power: mean((p) => p.power),
      targetPower: mean((p) => p.targetPower),
      heartRate: mean((p) => p.heartRate),
      cadence: mean((p) => p.cadence),
      speed: mean((p) => p.speed),
    });
  }

  return result;
}

interface PowerHrChartProps {
  dataPoints: SessionDataPoint[];
  ftp: number;
  /** Show all data instead of a rolling window (for post-session view) */
  showAll?: boolean;
}

export function PowerHrChart(props: PowerHrChartProps) {
  const { dataPoints, ftp, showAll = false } = props;
  const t = useT();
  const tokens = useChartTokens();
  const isMobile = useIsMobile();

  const points = React.useMemo(
    () =>
      showAll
        ? downsample(dataPoints, MAX_RENDERED_POINTS)
        : dataPoints.slice(-WINDOW_SECONDS),
    [dataPoints, showAll],
  );

  const xLabels = React.useMemo(() => {
    const totalPoints = points.length;
    return points.map((point, i) => {
      // The full-session view is bucket-averaged, so an index is no longer a
      // second — label it with the sample's own elapsed time instead.
      if (showAll) {
        const min = Math.floor(point.elapsed / 60);
        const sec = Math.floor(point.elapsed % 60);
        return `${min}:${String(sec).padStart(2, "0")}`;
      }
      const secsAgo = totalPoints - 1 - i;
      if (secsAgo === 0) return t("liveTraining.chart.now");
      const min = Math.floor(secsAgo / 60);
      const sec = secsAgo % 60;
      return `-${min}:${String(sec).padStart(2, "0")}`;
    });
  }, [points, showAll, t]);

  const powerColors = React.useMemo(
    () =>
      points.map((p) =>
        p.power != null && p.power > 0
          ? tokens.zones[findPowerZone(p.power, ftp).zone.ramp]
          : tokens.zones[0],
      ),
    [points, ftp, tokens],
  );

  const hasTargetPower = points.some((p) => p.targetPower != null);

  // A missing heart rate is a gap in the line, not a reading of zero — plotting
  // `?? 0` drew a flat line clamped to the axis floor, which reads as a real
  // (very low) heart rate rather than as "no sensor".
  const hrValues = React.useMemo(
    () => points.map((p) => p.heartRate ?? null),
    [points],
  );

  // Bounds follow the data, so sprints above a hardcoded ceiling are no longer
  // flat-topped. With no readings at all the line isn't drawn, so the fallback
  // range only has to be a plausible-looking empty axis.
  const hrBounds = React.useMemo(() => {
    const observed = hrValues.filter((v): v is number => v != null);
    if (observed.length === 0) return { min: 60, max: 200 };
    return {
      min: Math.max(0, Math.min(...observed) - HR_AXIS_PADDING),
      max: Math.max(...observed) + HR_AXIS_PADDING,
    };
  }, [hrValues]);

  const series = React.useMemo(
    () => [
      {
        type: "bar" as const,
        label: t("liveTraining.chart.power"),
        data: points.map((p) => p.power ?? 0),
        yAxisId: "power",
        valueFormatter: (value: number | null) =>
          value != null ? `${Math.round(value)} W` : "0 W",
        colorGetter: ({ dataIndex }: { dataIndex: number }) =>
          powerColors[dataIndex],
      },
      {
        type: "line" as const,
        label: t("liveTraining.chart.heartRate"),
        data: hrValues,
        yAxisId: "hr",
        color: tokens.palette[0],
        showMark: false,
        curve: "natural" as const,
        connectNulls: false,
        valueFormatter: (value: number | null) =>
          value != null ? `${Math.round(value)} bpm` : "--",
      },
      ...(hasTargetPower
        ? [
            {
              type: "line" as const,
              label: t("liveTraining.chart.target"),
              data: points.map((p) => p.targetPower ?? null),
              yAxisId: "power",
              color: tokens.palette[7],
              showMark: false,
              curve: "step" as const,
              connectNulls: false,
            },
          ]
        : []),
    ],
    [points, powerColors, hrValues, hasTargetPower, tokens.palette, t],
  );

  const totalPoints = points.length;
  const xTickInterval = React.useCallback(
    (_: unknown, index: number) => {
      if (showAll) {
        // Guard the divisor: a session shorter than 6 samples made this
        // `index % 0`, i.e. NaN, and every tick label disappeared.
        return index % Math.max(1, Math.floor(totalPoints / 6)) === 0;
      }
      return index % 60 === 0;
    },
    [showAll, totalPoints],
  );

  // MUI X Charts crashes when band-axis data is empty.
  if (points.length === 0) {
    return null;
  }

  return (
    <ChartThemeProvider>
      <ChartsContainerPro
        series={series}
        xAxis={[
          {
            id: "x",
            scaleType: "band",
            data: xLabels,
            tickLabelInterval: xTickInterval,
          },
        ]}
        yAxis={[
          {
            id: "power",
            position: "left",
            label: "W",
            min: 0,
          },
          {
            id: "hr",
            position: "right",
            label: "bpm",
            min: hrBounds.min,
            max: hrBounds.max,
          },
        ]}
        height={200}
        skipAnimation
        margin={isMobile ? { left: 24, right: 24, top: 8, bottom: 20 } : CHART_MARGINS.dualAxis}
      >
        <BarPlot />
        <LinePlot />
        <ChartsXAxis axisId="x" />
        <ChartsYAxis axisId="power" />
        <ChartsYAxis axisId="hr" />
      </ChartsContainerPro>
    </ChartThemeProvider>
  );
}
