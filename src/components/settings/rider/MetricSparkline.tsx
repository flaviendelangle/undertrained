import { useMemo } from "react";

import { SparkLineChart } from "@mui/x-charts-pro";

import { useChartTokens } from "~/lib/chartTokens";
import {
  DEFAULT_RIDER_SETTINGS_TIMELINE,
  type RiderSettingsTimeline,
  type TimeVaryingField,
} from "~/sensors/types";

import { ChartThemeProvider } from "../../charts/ChartThemeProvider";

const DEFAULTS = DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues;

/**
 * A tiny step sparkline of one field's resolved values over its change history.
 * Renders nothing when the field never changed (a flat line carries no signal).
 */
export function MetricSparkline({
  timeline,
  field,
  className,
}: {
  timeline: RiderSettingsTimeline;
  field: TimeVaryingField;
  className?: string;
}) {
  const tokens = useChartTokens();

  const data = useMemo(() => {
    const start = timeline.initialValues[field] ?? DEFAULTS[field]!;
    const values: number[] = [start];
    let current = start;
    for (const change of timeline.changes) {
      if (change[field] !== undefined) {
        current = change[field]!;
        values.push(current);
      }
    }
    // Repeat the last value so the final step is visible.
    values.push(current);
    return values;
  }, [timeline, field]);

  // Need at least one real change (4 points: start, change, …, repeat) to be meaningful.
  if (data.length < 3) return null;

  return (
    <ChartThemeProvider>
      <div className={className}>
        <SparkLineChart
          data={data}
          curve="stepAfter"
          color={tokens.palette[0]}
          height={36}
          showTooltip={false}
          showHighlight={false}
          margin={{ top: 4, bottom: 4, left: 0, right: 0 }}
        />
      </div>
    </ChartThemeProvider>
  );
}
