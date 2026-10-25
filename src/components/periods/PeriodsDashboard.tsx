import * as React from "react";

import { ArrowRightIcon, ListIcon, RouteIcon, TimerIcon } from "lucide-react";
import nextDynamic from "next/dynamic";
import Link from "next/link";

import { TimePeriodStats } from "~/components/periods/TimePeriodStats";
import {
  DeletePeriodButton,
  NewPeriodButton,
  type PeriodStatRow,
  PeriodSummaryCard,
  SportTypeIcons,
  formatPeriodRange,
} from "~/components/periods/shared";
import { Button } from "~/components/ui/button";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { formatCompactDuration, formatKm, formatNumber } from "~/utils/format";

const TimePeriodMap = nextDynamic(
  () =>
    import("~/components/periods/TimePeriodMap").then((m) => m.TimePeriodMap),
  { ssr: false },
);

interface PeriodsDashboardProps {
  stats: PeriodStatRow[];
  onDelete: (id: number) => Promise<void>;
}

export function PeriodsDashboard({ stats, onDelete }: PeriodsDashboardProps) {
  return (
    <div className="w-full max-w-7xl">
      {/* Desktop: master–detail. */}
      <DashboardMasterDetail stats={stats} onDelete={onDelete} />

      {/* Below desktop: cards that link to each period's page. On phone they go
          full-bleed (edge-to-edge, hairline dividers) to match the Statistics
          page; from `sm` up the existing 2-column card grid is unchanged. */}
      <div className="flex flex-col lg:hidden">
        <div className="flex items-center justify-end px-3 pb-3 sm:px-0 sm:pb-4">
          <NewPeriodButton />
        </div>
        <div className="divide-border border-border flex flex-col divide-y border-y sm:grid sm:grid-cols-2 sm:gap-4 sm:divide-y-0 sm:border-0">
          {stats.map((row) => (
            <PeriodSummaryCard
              key={row.period.id}
              row={row}
              onDelete={onDelete}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardMasterDetail({ stats, onDelete }: PeriodsDashboardProps) {
  const t = useT();
  const [selectedId, setSelectedId] = React.useState(stats[0]?.period.id);

  // Keep the selection valid as periods are added or removed.
  const selected =
    stats.find((s) => s.period.id === selectedId) ?? stats[0] ?? null;

  return (
    <div className="hidden gap-5 lg:flex">
      {/* Master list */}
      <aside
        className="flex w-80 shrink-0 flex-col gap-3"
        aria-label={t("periods.pageTitle")}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground text-sm font-medium">
            {t("periods.pageTitle")}
            <span className="bg-muted ml-2 rounded px-1.5 py-0.5 text-xs tabular-nums">
              {stats.length}
            </span>
          </span>
          <NewPeriodButton
            size="sm"
            variant="outline"
            label={t("periods.new")}
          />
        </div>
        <ul className="flex flex-col gap-2">
          {stats.map((row) => {
            const active = row.period.id === selected?.period.id;
            return (
              <li
                key={row.period.id}
                className={cn(
                  "group relative rounded-lg border transition-colors",
                  active
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-card hover:bg-muted/50",
                )}
              >
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedId(row.period.id)}
                  className="focus-visible:ring-ring flex w-full flex-col items-start gap-2 rounded-lg p-4 text-left outline-none focus-visible:ring-2"
                >
                  <span
                    className={cn(
                      "line-clamp-2 w-full pr-6 text-sm leading-snug font-semibold",
                      active ? "text-primary" : "text-foreground",
                    )}
                  >
                    {row.period.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatPeriodRange(
                      row.period.startDate,
                      row.period.endDate,
                    )}
                  </span>
                  <SportTypeIcons
                    sportTypes={row.period.sportTypes}
                    className="flex-wrap"
                  />
                  <span className="text-muted-foreground border-border mt-1 flex w-full flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 text-xs tabular-nums">
                    <span
                      className="flex items-center gap-1"
                      title={t("periods.stats.activities")}
                    >
                      <ListIcon className="size-3.5" aria-hidden />
                      <span className="sr-only">
                        {t("periods.stats.activities")}:{" "}
                      </span>
                      {formatNumber(row.activityCount, 0)}
                    </span>
                    <span
                      className="flex items-center gap-1"
                      title={t("periods.stats.distance")}
                    >
                      <RouteIcon className="size-3.5" aria-hidden />
                      <span className="sr-only">
                        {t("periods.stats.distance")}:{" "}
                      </span>
                      {formatKm(row.totalDistance, 0)}
                    </span>
                    <span
                      className="flex items-center gap-1"
                      title={t("periods.stats.movingTime")}
                    >
                      <TimerIcon className="size-3.5" aria-hidden />
                      <span className="sr-only">
                        {t("periods.stats.movingTime")}:{" "}
                      </span>
                      {formatCompactDuration(row.totalMovingTime, {
                        subHour: "min",
                      })}
                    </span>
                  </span>
                </button>
                <DeletePeriodButton
                  name={row.period.name}
                  onDelete={() => onDelete(row.period.id)}
                  className="absolute top-3 right-3 group-focus-within:opacity-100"
                />
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Detail panel */}
      {selected && (
        <div className="flex min-w-0 flex-1 flex-col gap-4 sm:gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-bold">
                {selected.period.name}
              </h2>
              <div className="mt-1 flex items-center gap-3">
                <span className="text-muted-foreground text-sm">
                  {formatPeriodRange(
                    selected.period.startDate,
                    selected.period.endDate,
                  )}
                </span>
                <SportTypeIcons sportTypes={selected.period.sportTypes} />
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/time-periods/${selected.period.id}`} />}
            >
              {t("periods.openPeriod")}
              <ArrowRightIcon className="size-4" />
            </Button>
          </div>

          <TimePeriodStats
            activityCount={selected.activityCount}
            totalMovingTime={selected.totalMovingTime}
            totalElapsedTime={selected.totalElapsedTime}
            totalDistance={selected.totalDistance}
            totalElevation={selected.totalElevation}
          />

          <div className="border-border bg-card overflow-hidden rounded-sm border">
            <div className="relative h-80 w-full">
              <TimePeriodMap
                key={selected.period.id}
                periodId={selected.period.id}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
