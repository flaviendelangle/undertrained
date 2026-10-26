import * as React from "react";

import { ChartCard } from "~/components/ui/chart-card";
import { useActivitiesFilteredByType } from "~/hooks/useActivitiesFilteredByType";
import { powerZoneLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { formatElapsed } from "~/utils/format";

import { ChartMessage } from "../ChartMessage";
import { ChartThemeProvider } from "../ChartThemeProvider";
import { aggregateTimeInZones, buildZoneRows } from "./timeInZones";

export default function TimeInZones() {
  const t = useT();
  const tokens = useChartTokens();
  const activitiesQuery = useActivitiesFilteredByType([]);

  const {
    rows,
    powerOnly,
    unknownSeconds,
    coastingSeconds,
    totalSeconds,
    maxSeconds,
  } = React.useMemo(() => {
    const agg = aggregateTimeInZones(activitiesQuery.activities ?? []);
    const rows = buildZoneRows(agg);
    const maxSeconds = Math.max(
      1,
      agg.unknownSeconds,
      agg.coastingSeconds,
      ...rows.map((row) => row.seconds),
    );
    return {
      rows,
      powerOnly: agg.metrics.size === 1 && agg.metrics.has("power"),
      unknownSeconds: agg.unknownSeconds,
      coastingSeconds: agg.coastingSeconds,
      totalSeconds: agg.totalSeconds,
      maxSeconds,
    };
  }, [activitiesQuery.activities]);

  const renderRow = (
    key: string,
    code: string,
    name: string | null,
    seconds: number,
    barColor?: string,
  ) => {
    const pct = totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0;
    const barPct = (seconds / maxSeconds) * 100;

    return (
      <div
        key={key}
        className="flex flex-1 items-center gap-2 text-sm sm:gap-3"
      >
        <span className="bg-muted text-muted-foreground inline-flex w-9 shrink-0 items-center justify-center rounded py-1 text-xs font-medium">
          {code}
        </span>
        <div className="flex min-w-0 shrink-0 basis-20 flex-col leading-tight sm:basis-32">
          <span className="truncate font-medium">{name ?? code}</span>
        </div>
        <span className="w-14 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">
          {formatElapsed(seconds)}
        </span>
        <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
          {Math.round(pct)} %
        </span>
        <div className="bg-muted/50 h-6 min-w-0 flex-1 overflow-hidden rounded">
          <div
            className={
              barColor == null
                ? "bg-muted-foreground/40 h-full rounded"
                : "h-full rounded"
            }
            style={{
              width: `${barPct}%`,
              ...(barColor != null && { backgroundColor: barColor }),
            }}
          />
        </div>
      </div>
    );
  };

  return (
    <ChartThemeProvider>
      <ChartCard
        title={t("charts.timeInZones.title")}
        info={t("charts.timeInZones.info")}
      >
        {totalSeconds === 0 ? (
          <ChartMessage>{t("charts.timeInZones.empty")}</ChartMessage>
        ) : (
          <div className="flex h-full flex-col px-4 py-2">
            {rows.map((row) =>
              renderRow(
                row.code,
                row.code,
                powerOnly ? powerZoneLabel(row.ramp, t) : row.name,
                row.seconds,
                tokens.zones[row.ramp],
              ),
            )}
            {coastingSeconds > 0 &&
              renderRow(
                "coasting",
                "Z0",
                t("charts.power.coasting"),
                coastingSeconds,
                tokens.gridStrong.hex,
              )}
            {unknownSeconds > 0 &&
              renderRow(
                "unknown",
                "–",
                t("charts.timeInZones.unknown"),
                unknownSeconds,
              )}
          </div>
        )}
      </ChartCard>
    </ChartThemeProvider>
  );
}
