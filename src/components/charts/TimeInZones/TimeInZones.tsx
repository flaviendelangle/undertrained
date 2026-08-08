import * as React from "react";

import { isValid } from "date-fns";
import { SlidersHorizontalIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ChartCard } from "~/components/ui/chart-card";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverHeader,
  ResponsivePopoverTitle,
  ResponsivePopoverTrigger,
} from "~/components/ui/responsive-popover";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { useActivitiesFilteredByType } from "~/hooks/useActivitiesFilteredByType";
import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { startOf } from "~/utils/dateUtils";
import { formatElapsed } from "~/utils/format";

import { ChartMessage } from "../ChartMessage";
import { ChartThemeProvider } from "../ChartThemeProvider";
import { SportFilterPopover, SportTypeFilter } from "../SportTypeFilter";
import {
  type ZoneTimeSpan,
  aggregateTimeInZones,
  buildZoneRows,
  zoneMetricForSport,
} from "./timeInZones";

export default function TimeInZones() {
  const t = useT();
  const tokens = useChartTokens();
  const [selectedTypes, setSelectedTypes] = React.useState<string[]>([]);
  const [timeSpan, setTimeSpan] = React.useState<ZoneTimeSpan>("week");
  const activitiesQuery = useActivitiesFilteredByType(selectedTypes);

  // Sports without a zone system (swimming) are excluded from the chart, so
  // offering them in the filter would only produce an empty card.
  const zoneTypes = React.useMemo(
    () =>
      activitiesQuery.allTypes?.filter(
        (type) => zoneMetricForSport(type) != null,
      ),
    [activitiesQuery.allTypes],
  );

  const { rows, unknownSeconds, totalSeconds, maxSeconds } =
    React.useMemo(() => {
      const spanStart = startOf(new Date(), timeSpan);
      const spanActivities = (activitiesQuery.activities ?? []).filter((a) => {
        const date = new Date(a.startDate);
        return isValid(date) && date >= spanStart;
      });

      const agg = aggregateTimeInZones(spanActivities);
      const rows = buildZoneRows(agg);
      const maxSeconds = Math.max(
        1,
        agg.unknownSeconds,
        ...rows.map((row) => row.seconds),
      );
      return {
        rows,
        unknownSeconds: agg.unknownSeconds,
        totalSeconds: agg.totalSeconds,
        maxSeconds,
      };
    }, [activitiesQuery.activities, timeSpan]);

  const timeSpanOptions = React.useMemo(
    () =>
      (["week", "month", "year"] as const).map((value) => ({
        value,
        label: t(`charts.timeInZones.timeSpan.${value}`),
      })),
    [t],
  );

  const timeSpanToggle = (
    <SegmentedToggle
      value={timeSpan}
      onChange={setTimeSpan}
      options={timeSpanOptions}
    />
  );

  const actions = (
    <>
      {/* Desktop: inline controls */}
      <div className="hidden items-center gap-2 sm:flex">{timeSpanToggle}</div>

      <div className="flex-1" />

      {/* Mobile: all controls in popover (drawer on mobile) */}
      <ResponsivePopover>
        <ResponsivePopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground sm:hidden"
            >
              <SlidersHorizontalIcon className="size-4" />
            </Button>
          }
        />
        <ResponsivePopoverContent
          align="end"
          className="flex flex-col gap-3 sm:w-56"
        >
          <ResponsivePopoverHeader>
            <ResponsivePopoverTitle>
              {t("charts.displayOptions")}
            </ResponsivePopoverTitle>
          </ResponsivePopoverHeader>
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              {t("charts.timeInZones.timeSpanLabel")}
            </span>
            {timeSpanToggle}
          </div>
          <SportTypeFilter
            allTypes={zoneTypes}
            selectedTypes={selectedTypes}
            setSelectedTypes={setSelectedTypes}
          />
        </ResponsivePopoverContent>
      </ResponsivePopover>

      {/* Desktop: sport filter */}
      <SportFilterPopover
        allTypes={zoneTypes}
        selectedTypes={selectedTypes}
        setSelectedTypes={setSelectedTypes}
      />
    </>
  );

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
        actions={actions}
      >
        {totalSeconds === 0 ? (
          <ChartMessage>{t("charts.timeInZones.empty")}</ChartMessage>
        ) : (
          <div className="flex h-full flex-col px-4 py-2">
            {rows.map((row) =>
              renderRow(
                row.code,
                row.code,
                row.name,
                row.seconds,
                tokens.zones[row.ramp],
              ),
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
