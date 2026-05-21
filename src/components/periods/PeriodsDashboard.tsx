import * as React from "react";

import { ArrowRightIcon } from "lucide-react";
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
import { cn } from "~/lib/utils";

const TimePeriodMap = nextDynamic(
  () =>
    import("~/components/periods/TimePeriodMap").then((m) => m.TimePeriodMap),
  { ssr: false },
);

interface PeriodsDashboardProps {
  stats: PeriodStatRow[];
  onDelete: (id: number) => void;
}

export function PeriodsDashboard({ stats, onDelete }: PeriodsDashboardProps) {
  return (
    <div className="w-full max-w-7xl">
      {/* Desktop: master–detail. */}
      <DashboardMasterDetail stats={stats} onDelete={onDelete} />

      {/* Mobile: a simple list of cards that link to the full period page. */}
      <div className="flex flex-col gap-4 lg:hidden">
        <div className="flex items-center justify-end max-sm:px-3">
          <NewPeriodButton />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
  const [selectedId, setSelectedId] = React.useState(stats[0]?.period.id);

  // Keep the selection valid as periods are added or removed.
  const selected =
    stats.find((s) => s.period.id === selectedId) ?? stats[0] ?? null;

  return (
    <div className="hidden gap-5 lg:flex">
      {/* Master list */}
      <div className="flex w-72 shrink-0 flex-col gap-3">
        <div className="flex items-center justify-end">
          <NewPeriodButton size="sm" variant="outline" label="New" />
        </div>
        <div className="border-border bg-card flex flex-col overflow-hidden rounded-sm border">
          {stats.map((row) => {
            const active = row.period.id === selected?.period.id;
            return (
              <button
                key={row.period.id}
                type="button"
                onClick={() => setSelectedId(row.period.id)}
                className={cn(
                  "group border-border hover:bg-muted/50 flex flex-col items-start gap-1 border-b border-l-2 px-4 py-3 text-left transition-colors last:border-b-0",
                  active
                    ? "border-l-primary bg-muted/60"
                    : "border-l-transparent",
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span
                    className={cn(
                      "min-w-0 truncate text-sm font-medium",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {row.period.name}
                  </span>
                  <DeletePeriodButton
                    name={row.period.name}
                    onDelete={() => onDelete(row.period.id)}
                  />
                </div>
                <span className="text-muted-foreground text-xs">
                  {formatPeriodRange(row.period.startDate, row.period.endDate)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

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
              render={<Link href={`/periods/${selected.period.id}`} />}
            >
              Open period
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
