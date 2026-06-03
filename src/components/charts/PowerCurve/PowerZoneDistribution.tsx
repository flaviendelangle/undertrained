import * as React from "react";

import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { formatElapsed } from "~/utils/format";

import { ChartMessage } from "../ChartMessage";
import { computePowerZoneDistribution } from "./powerDistribution";

interface PowerZoneDistributionProps {
  /** Per-second watts samples for the activity. */
  watts: number[];
  /** FTP in effect on the activity's date — drives the zone boundaries. */
  ftp: number;
}

/**
 * Time spent in each power zone, as a Z7→Z1 list of rows carrying the zone's
 * watt range, time, share, and a bar scaled to the busiest zone. Zones (names,
 * colours, boundaries) are identical to the Laps card.
 */
export function PowerZoneDistribution({
  watts,
  ftp,
}: PowerZoneDistributionProps) {
  const t = useT();
  const tokens = useChartTokens();

  const { rows, total, maxSeconds } = React.useMemo(() => {
    const buckets = computePowerZoneDistribution(watts, ftp);
    let total = 0;
    let maxSeconds = 1;
    for (const b of buckets) {
      total += b.seconds;
      if (b.seconds > maxSeconds) maxSeconds = b.seconds;
    }
    // Highest zone first, mirroring the reference layout.
    return { rows: [...buckets].reverse(), total, maxSeconds };
  }, [watts, ftp]);

  if (watts.length === 0 || total === 0) {
    return <ChartMessage>{t("charts.power.empty")}</ChartMessage>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col px-4 py-2">
        {rows.map((bucket) => {
          const pct = total > 0 ? (bucket.seconds / total) * 100 : 0;
          const barPct = (bucket.seconds / maxSeconds) * 100;
          const range =
            bucket.upperWatts == null
              ? `${bucket.lowerWatts}+ W`
              : `${bucket.lowerWatts}–${bucket.upperWatts} W`;

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
                <span className="text-muted-foreground text-xs">{range}</span>
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
        {t("charts.power.basedOnFtp", { ftp: Math.round(ftp) })}
      </div>
    </div>
  );
}
