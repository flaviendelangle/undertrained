import * as React from "react";

import {
  CalendarPlusIcon,
  ListIcon,
  MountainIcon,
  PlusIcon,
  RouteIcon,
  TimerIcon,
  TrashIcon,
} from "lucide-react";
import Link from "next/link";

import type { AppRouter } from "@server/trpc/root";
import type { inferRouterOutputs } from "@trpc/server";

import { TimePeriodForm } from "~/components/periods/TimePeriodForm";
import { StatCard } from "~/components/primitives/StatCard";
import { Button } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "~/components/ui/responsive-dialog";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { formatHumanDuration } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";

/** A single row from `timePeriods.getStats` — one period plus its aggregated totals. */
export type PeriodStatRow =
  inferRouterOutputs<AppRouter>["timePeriods"]["getStats"][number];

/** Format a period's `YYYY-MM-DD` range as a compact, human label, e.g. `Jun 21 – Jul 19, 2023`. */
export function formatPeriodRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const monthDay = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const withYear = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return sameYear
    ? `${monthDay(start)} – ${withYear(end)}`
    : `${withYear(start)} – ${withYear(end)}`;
}

/** Distance in km with one decimal, e.g. `792.4 km`. */
export function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Elevation in metres, rounded, e.g. `19437 m`. */
export function formatElevation(meters: number): string {
  return `${Math.round(meters)} m`;
}

/** A small row of sport-type icons (or an "All sports" hint when unfiltered). */
export function SportTypeIcons({
  sportTypes,
  className,
}: {
  sportTypes: string[] | null;
  className?: string;
}) {
  const t = useT();
  if (!sportTypes || sportTypes.length === 0) {
    return (
      <span className={cn("text-muted-foreground text-xs", className)}>
        {t("periods.allSports")}
      </span>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {sportTypes.map((type) => {
        const Icon = getSportConfig(type).icon;
        return (
          <span
            key={type}
            title={sportTypeLabel(type, t)}
            className="text-muted-foreground bg-muted flex size-6 items-center justify-center rounded-md"
          >
            <Icon className="size-3.5" />
          </span>
        );
      })}
    </div>
  );
}

/** Primary call-to-action that opens the create form inside a dialog. */
export function NewPeriodButton({
  size = "sm",
  variant = "default",
  label,
}: {
  size?: "sm" | "default";
  variant?: "default" | "outline";
  label?: string;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger
        render={<Button size={size} variant={variant} />}
      >
        <PlusIcon className="size-4" />
        {label ?? t("periods.newPeriod")}
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("periods.newTimePeriod")}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <TimePeriodForm onSuccess={() => setOpen(false)} />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** Hover-revealed delete button that asks for confirmation before deleting. */
export function DeletePeriodButton({
  name,
  onDelete,
  className,
}: {
  name: string;
  onDelete: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("periods.deletePeriod")}
            className={cn(
              "text-muted-foreground hover:text-destructive relative z-10 opacity-0 transition-opacity group-hover:opacity-100",
              className,
            )}
            // Inside clickable cards/rows: keep the click from triggering navigation.
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        }
      >
        <TrashIcon className="size-3.5" />
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent showCloseButton={false}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("periods.deleteConfirmTitle", { name })}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t("periods.deleteConfirmDescription")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose render={<Button variant="outline" />}>
            {t("common.cancel")}
          </ResponsiveDialogClose>
          <ResponsiveDialogClose
            render={<Button variant="destructive" />}
            onClick={onDelete}
          >
            {t("common.delete")}
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * A clickable summary card for one period — name, range, sports and a 2×2 stat
 * grid. The whole card links to the period's detail page. Used by the
 * Dashboard's below-desktop layout: full-bleed on phone (the page-level hairline
 * dividers separate cards), then a boxed card (`bg-card`, `rounded-sm`, header
 * split by a border) from `sm` up to match the Statistics page.
 */
export function PeriodSummaryCard({
  row,
  onDelete,
}: {
  row: PeriodStatRow;
  onDelete: (id: number) => void;
}) {
  const t = useT();
  return (
    <div className="sm:bg-card relative flex flex-col sm:rounded-sm">
      <div className="border-border flex items-start justify-between gap-2 p-4 sm:border-b">
        <div className="min-w-0">
          <Link
            href={`/time-periods/${row.period.id}`}
            className="text-foreground block truncate text-lg font-semibold after:absolute after:inset-0"
          >
            {row.period.name}
          </Link>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {formatPeriodRange(row.period.startDate, row.period.endDate)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SportTypeIcons sportTypes={row.period.sportTypes} />
          {/* Always visible: there is no hover on touch devices. */}
          <DeletePeriodButton
            name={row.period.name}
            onDelete={() => onDelete(row.period.id)}
            className="opacity-100"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-3 p-4">
        <StatCard
          icon={ListIcon}
          label={t("periods.stats.activities")}
          value={row.activityCount}
        />
        <StatCard
          icon={TimerIcon}
          label={t("periods.stats.moving")}
          value={formatHumanDuration(row.totalMovingTime)}
        />
        <StatCard
          icon={RouteIcon}
          label={t("periods.stats.distance")}
          value={formatKm(row.totalDistance)}
        />
        <StatCard
          icon={MountainIcon}
          label={t("periods.stats.elevation")}
          value={formatElevation(row.totalElevation)}
        />
      </div>
    </div>
  );
}

/** Shown when the athlete has no periods yet — the form becomes the focus. */
export function PeriodsEmptyState() {
  const t = useT();
  return (
    <div className="border-border bg-card mx-auto w-full max-w-lg rounded-xl border p-6 sm:p-8">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
          <CalendarPlusIcon className="size-6" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">
            {t("periods.emptyTitle")}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("periods.emptyDescription")}
          </p>
        </div>
      </div>
      <TimePeriodForm />
    </div>
  );
}
