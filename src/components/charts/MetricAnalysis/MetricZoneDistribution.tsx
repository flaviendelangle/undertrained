import * as React from "react";

import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { formatElapsed } from "~/utils/format";

import { ChartMessage } from "../ChartMessage";
import type { MetricDescriptor } from "./types";

interface MetricZoneDistributionProps {
  metric: MetricDescriptor;
  /** Per-second samples for the activity, in the recorded unit. */
  values: readonly number[];
  /** Threshold in effect on the activity's date — drives the zone boundaries. */
  threshold: number;
  /** Pre-aggregated seconds per zone, used by date-range cards. */
  zoneSeconds?: readonly number[];
  /** Pre-aggregated seconds of the zero bucket (power's coasting), likewise. */
  zeroSeconds?: number;
  /** Zone totals were computed with each activity's date-specific threshold. */
  aggregate?: boolean;
}

/**
 * Time spent in each zone, as a hardest-first list of rows carrying the zone's
 * range, time, share, and a bar scaled to the busiest zone. Zones (names,
 * colours, boundaries) are identical to the Laps card.
 */
export function MetricZoneDistribution({
  metric,
  values,
  threshold,
  zoneSeconds,
  zeroSeconds = 0,
  aggregate = false,
}: MetricZoneDistributionProps) {
  const t = useT();
  const tokens = useChartTokens();

  const { rows, total, maxSeconds } = React.useMemo(() => {
    const buckets = metric.zoneBuckets(values, threshold, t).map((bucket) => ({
      ...bucket,
      seconds:
        zoneSeconds == null
          ? bucket.seconds
          : bucket.index == null
            ? zeroSeconds
            : (zoneSeconds[bucket.index] ?? 0),
    }));
    let total = 0;
    let maxSeconds = 1;
    for (const b of buckets) {
      total += b.seconds;
      if (b.seconds > maxSeconds) maxSeconds = b.seconds;
    }
    // Highest zone first, mirroring the reference layout.
    return { rows: [...buckets].reverse(), total, maxSeconds };
  }, [metric, values, threshold, t, zoneSeconds, zeroSeconds]);

  if (metric.messages.noThreshold && threshold <= 0) {
    return <ChartMessage>{t(metric.messages.noThreshold)}</ChartMessage>;
  }

  if ((values.length === 0 && zoneSeconds == null) || total === 0) {
    return <ChartMessage>{t(metric.messages.empty)}</ChartMessage>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col px-4 py-2">
        {rows.map((bucket) => {
          const pct = total > 0 ? (bucket.seconds / total) * 100 : 0;
          const barPct = (bucket.seconds / maxSeconds) * 100;

          return (
            <div
              key={bucket.code}
              className="flex flex-1 items-center gap-2 text-sm sm:gap-3"
            >
              <span className="bg-muted text-muted-foreground inline-flex w-9 shrink-0 items-center justify-center rounded py-1 text-xs font-medium">
                {bucket.code}
              </span>
              <div className="flex min-w-0 shrink-0 basis-28 flex-col leading-tight sm:basis-40">
                <span className="truncate font-medium">{bucket.label}</span>
                {!aggregate && (
                  <span className="text-muted-foreground text-xs">
                    {bucket.range}
                  </span>
                )}
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">
                {formatElapsed(bucket.seconds)}
              </span>
              <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
                {Math.round(pct)} %
              </span>
              <div className="bg-muted/50 h-6 min-w-0 flex-1 overflow-hidden rounded">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${barPct}%`,
                    backgroundColor:
                      bucket.index == null
                        ? tokens.gridStrong.hex
                        : tokens.zones[bucket.index],
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-border text-muted-foreground shrink-0 border-t px-4 py-2 text-xs md:border-t-0">
        {metric.formatThresholdNote(threshold, aggregate, t)}
      </div>
    </div>
  );
}
