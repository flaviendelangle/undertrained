import * as React from "react";

import {
  ArrowLeftIcon,
  CalendarIcon,
  Maximize2,
  Minimize2,
} from "lucide-react";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/router";

import { ActivitiesTable } from "~/components/ActivitiesTable";
import { PageTitle } from "~/components/PageTitle";
import { TimePeriodForm } from "~/components/periods/TimePeriodForm";
import { TimePeriodStats } from "~/components/periods/TimePeriodStats";
import { CardTitle } from "~/components/primitives/CardTitle";
import { Toolbar } from "~/components/settings/SettingsToolbar";
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

import { useAthleteId } from "~/hooks/useAthleteId";
import { useTypedParams } from "~/hooks/useTypedParams";
import type { NextPageWithLayout } from "~/pages/_app";
import { formatActivityType } from "~/utils/format";
import { trpc } from "~/utils/trpc";

const TimePeriodMap = nextDynamic(
  () =>
    import("~/components/periods/TimePeriodMap").then(
      (m) => m.TimePeriodMap,
    ),
  { ssr: false },
);

const PowerCurve = nextDynamic(
  () => import("~/components/charts/PowerCurve").then((m) => m.PowerCurve),
  { ssr: false },
);

const POWER_ACTIVITY_TYPES = ["Ride", "VirtualRide"];

const routerSchema = { periodId: "string" as const };

const TimePeriodPage: NextPageWithLayout = () => {
  const params = useTypedParams(routerSchema);
  const periodId = params?.periodId ? Number(params.periodId) : undefined;

  if (periodId == null || isNaN(periodId)) {
    return null;
  }

  return (
    <React.Suspense fallback={<TimePeriodPageSkeleton />}>
      <TimePeriodPageContent periodId={periodId} />
    </React.Suspense>
  );
};

function TimePeriodPageContent({ periodId }: { periodId: number }) {
  const athleteId = useAthleteId();
  const [mapExpanded, setMapExpanded] = React.useState(false);
  const [data] = trpc.timePeriods.getById.useSuspenseQuery({
    athleteId: athleteId!,
    id: periodId,
  });

  const { period } = data;

  const hasPower =
    !period.sportTypes ||
    period.sportTypes.length === 0 ||
    period.sportTypes.some((t) => POWER_ACTIVITY_TYPES.includes(t));

  const powerActivityTypes =
    period.sportTypes && period.sportTypes.length > 0
      ? period.sportTypes.filter((t) => POWER_ACTIVITY_TYPES.includes(t))
      : POWER_ACTIVITY_TYPES;

  React.useEffect(() => {
    if (!mapExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMapExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mapExpanded]);

  return (
    <>
      <PageTitle title={period.name} />
      <Toolbar>
        <Link
          href="/time-periods"
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-lg transition-colors"
        >
          <ArrowLeftIcon className="size-4" />
        </Link>
        <span className="min-w-0 truncate font-semibold">{period.name}</span>
        <span className="bg-accent text-accent-foreground inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium">
          <CalendarIcon className="size-3.5" />
          {period.startDate} &mdash; {period.endDate}
        </span>
        {period.sportTypes && period.sportTypes.length > 0 && (
          <span className="text-muted-foreground hidden text-xs sm:inline">
            {period.sportTypes.map(formatActivityType).join(", ")}
          </span>
        )}
        <div className="flex-1" />
      </Toolbar>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {mapExpanded && (
          <div className="bg-background fixed inset-0 z-50 flex flex-col">
            <div className="relative min-h-0 flex-1">
              <TimePeriodMap periodId={periodId} />
              <button
                onClick={() => setMapExpanded(false)}
                className="bg-background/80 hover:bg-background text-foreground absolute right-3 top-3 z-20 flex size-8 items-center justify-center rounded-lg backdrop-blur-sm transition-colors"
                title="Collapse map"
              >
                <Minimize2 className="size-4" />
              </button>
            </div>
          </div>
        )}
        {!mapExpanded && (
          <div className="relative h-[50vh] min-h-80 max-h-[600px] w-full">
            <TimePeriodMap periodId={periodId} />
            <div className="from-background pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t to-transparent" />
            <button
              onClick={() => setMapExpanded(true)}
              className="bg-background/80 hover:bg-background text-foreground absolute right-3 top-3 flex size-8 items-center justify-center rounded-lg backdrop-blur-sm transition-colors"
              title="Expand map"
            >
              <Maximize2 className="size-4" />
            </button>
          </div>
        )}
        <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">
          <TimePeriodStats {...data} />
          <div className="border-border bg-background flex h-[28rem] flex-col overflow-hidden rounded-xl border">
            <div className="border-border border-b p-4">
              <CardTitle>Activities</CardTitle>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ActivitiesTable timePeriodId={periodId} />
            </div>
          </div>
          {hasPower && powerActivityTypes.length > 0 && (
            <PowerCurve
              activityTypes={powerActivityTypes}
              defaultRanges={[
                {
                  id: `period-${period.id}`,
                  label: period.name,
                  dateFrom: period.startDate,
                  dateTo: period.endDate,
                },
              ]}
            />
          )}
          <section className="border-border bg-card rounded-xl border p-5">
            <CardTitle className="mb-4">Edit Period</CardTitle>
            <TimePeriodForm period={period} />
            <DeletePeriodButton athleteId={athleteId} period={period} />
          </section>
        </div>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────
// Delete button with confirm dialog
// ──────────────────────────────────────────────

function DeletePeriodButton({
  athleteId,
  period,
}: {
  athleteId: number | undefined;
  period: { id: number; name: string };
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const deleteMutation = trpc.timePeriods.delete.useMutation({
    onSuccess: () => {
      void utils.timePeriods.invalidate();
      void router.push("/time-periods");
    },
  });

  return (
    <div className="border-border mt-4 flex items-center justify-between border-t pt-4">
      <p className="text-muted-foreground text-sm">
        Permanently delete this period and remove it from your list.
      </p>
      <ResponsiveDialog>
        <ResponsiveDialogTrigger
          render={
            <Button variant="destructive" size="sm" />
          }
        >
          Delete
        </ResponsiveDialogTrigger>
        <ResponsiveDialogContent showCloseButton={false}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Delete &ldquo;{period.name}&rdquo;?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              This action cannot be undone. The period will be permanently
              deleted.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose render={<Button variant="outline" />}>
              Cancel
            </ResponsiveDialogClose>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!athleteId) return;
                deleteMutation.mutate({ athleteId, id: period.id });
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}

// ──────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────

function TimePeriodPageSkeleton() {
  return (
    <>
      <Toolbar>
        <div className="bg-accent size-8 animate-pulse rounded-lg" />
        <div className="bg-accent h-6 w-48 animate-pulse rounded" />
        <div className="bg-accent h-5 w-40 animate-pulse rounded-md" />
      </Toolbar>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="bg-secondary h-[50vh] min-h-80 max-h-[600px] w-full animate-pulse" />
        <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">
          <div className="border-border bg-card rounded-xl border p-5">
            <div className="bg-accent mb-4 h-7 w-36 animate-pulse rounded" />
            <div className="border-border mb-4 grid grid-cols-2 gap-2.5 border-b pb-4 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <div className="bg-accent mb-1 h-3 w-16 animate-pulse rounded" />
                  <div className="bg-accent mt-1 h-8 w-24 animate-pulse rounded" />
                </div>
              ))}
            </div>
          </div>
          <div className="bg-card h-96 animate-pulse rounded-xl" />
        </div>
      </div>
    </>
  );
}

export default TimePeriodPage;
