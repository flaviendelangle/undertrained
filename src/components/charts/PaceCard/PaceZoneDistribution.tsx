import * as React from "react";

import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { formatElapsed, formatMinutesSeconds } from "~/utils/format";

import { ChartMessage } from "../ChartMessage";
import {
  type PaceZoneBucket,
  computePaceZoneDistribution,
} from "./paceDistribution";
import { paceFromSpeed } from "./paceOverTime";

interface PaceZoneDistributionProps {
  /** Per-second speed samples (m/s) for the activity. */
  speeds: number[];
  /** Run threshold pace as a speed (m/s) — drives the zone boundaries. */
  thresholdSpeed: number;
}

/** "3:44–4:10 /km", "< 3:44 /km" (fastest, open) or "> 5:23 /km" (slowest, open). */
function formatPaceRange(bucket: PaceZoneBucket): string {
  const fmt = (s: number) => `${formatMinutesSeconds(s)} /km`;
  if (bucket.fastPaceSeconds == null && bucket.slowPaceSeconds == null) {
    return "—";
  }
  if (bucket.fastPaceSeconds == null)
    return `< ${fmt(bucket.slowPaceSeconds!)}`;
  if (bucket.slowPaceSeconds == null) return `> ${fmt(bucket.fastPaceSeconds)}`;
  return `${formatMinutesSeconds(bucket.fastPaceSeconds)}–${fmt(bucket.slowPaceSeconds)}`;
}

/**
 * Time spent in each running pace zone, as a Z5c→Z1 list of rows carrying the
 * zone's pace range, time, share, and a bar scaled to the busiest zone. Zones
 * (names, colours, boundaries) are identical to the Laps card.
 */
export function PaceZoneDistribution({
  speeds,
  thresholdSpeed,
}: PaceZoneDistributionProps) {
  const t = useT();
  const tokens = useChartTokens();

  const { rows, total, maxSeconds } = React.useMemo(() => {
    const buckets = computePaceZoneDistribution(speeds, thresholdSpeed);
    let total = 0;
    let maxSeconds = 1;
    for (const b of buckets) {
      total += b.seconds;
      if (b.seconds > maxSeconds) maxSeconds = b.seconds;
    }
    // Fastest zone first, mirroring the Power card's high-to-low layout.
    return { rows: [...buckets].reverse(), total, maxSeconds };
  }, [speeds, thresholdSpeed]);

  if (thresholdSpeed <= 0) {
    return <ChartMessage>{t("charts.pace.noThreshold")}</ChartMessage>;
  }

  if (speeds.length === 0 || total === 0) {
    return <ChartMessage>{t("charts.pace.empty")}</ChartMessage>;
  }

  const thresholdPace = paceFromSpeed(thresholdSpeed);

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
                <span className="truncate font-medium">{bucket.name}</span>
                <span className="text-muted-foreground text-xs">
                  {formatPaceRange(bucket)}
                </span>
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
                    backgroundColor: tokens.zones[bucket.index],
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-border text-muted-foreground shrink-0 border-t px-4 py-2 text-xs md:border-t-0">
        {t("charts.pace.basedOnThreshold", {
          pace: formatMinutesSeconds(thresholdPace),
        })}
      </div>
    </div>
  );
}
