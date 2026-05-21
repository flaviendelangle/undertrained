import * as React from "react";

import { ArrowLeftIcon, Maximize2, Minimize2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";

import { ActivityActionsMenu } from "~/components/ActivityActionsMenu";
import { PageTitle } from "~/components/PageTitle";
import { ActivityMap } from "~/components/ActivityMap";
import { ActivityStats } from "~/components/ActivityStats";
import { ElevationProfile } from "~/components/ElevationProfile";
import { ActivityLaps } from "~/components/charts/ActivityLaps";
import { ActivityStreams } from "~/components/charts/ActivityStreams";
import { PowerCurve } from "~/components/charts/PowerCurve";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { useTypedParams } from "~/hooks/useTypedParams";
import { NextPageWithLayout } from "~/pages/_app";
import { formatActivityType } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

const routerSchema = { activityId: "string" as const };

const ActivityPage: NextPageWithLayout = () => {
  const params = useTypedParams(routerSchema);
  const stravaId = params?.activityId ? Number(params.activityId) : undefined;

  if (stravaId == null) {
    return null;
  }

  return (
    <React.Suspense fallback={<ActivityPageSkeleton />}>
      <ActivityPageContent stravaId={stravaId} />
    </React.Suspense>
  );
};

function ActivityPageContent({ stravaId }: { stravaId: number }) {
  const router = useRouter();
  const backHref =
    router.query.from === "period" && router.query.periodId
      ? `/time-periods/${String(router.query.periodId)}`
      : router.query.from === "journal"
        ? "/journal"
        : "/activities";

  const [hoverPosition, setHoverPosition] = React.useState<
    [number, number] | null
  >(null);
  const [mapExpanded, setMapExpanded] = React.useState(false);

  React.useEffect(() => {
    if (!mapExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMapExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mapExpanded]);

  const [activity] = trpc.activities.get.useSuspenseQuery({ stravaId });
  const [streamsData] = trpc.activityStreams.getStreams.useSuspenseQuery({
    stravaId,
  });

  const latlngRoute = React.useMemo(() => {
    if (!streamsData) return null;
    const stream = streamsData.find((s) => s.type === "latlng");
    if (!stream) return null;
    try {
      return JSON.parse(stream.data) as [number, number][];
    } catch {
      return null;
    }
  }, [streamsData]);

  const altitudeData = React.useMemo(() => {
    if (!streamsData) return null;
    const stream = streamsData.find((s) => s.type === "altitude");
    if (!stream) return null;
    try {
      return JSON.parse(stream.data) as number[];
    } catch {
      return null;
    }
  }, [streamsData]);

  const distanceData = React.useMemo(() => {
    if (!streamsData) return null;
    const stream = streamsData.find((s) => s.type === "distance");
    if (!stream) return null;
    try {
      return JSON.parse(stream.data) as number[];
    } catch {
      return null;
    }
  }, [streamsData]);

  const hiddenStreams = React.useMemo(() => {
    if (!activity) return [];
    const hidden: string[] = [];
    if (activity.distance === 0) hidden.push("velocity_smooth");
    if (activity.totalElevationGain === 0) hidden.push("altitude");
    return hidden;
  }, [activity]);

  if (!activity) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-muted-foreground">Activity not found</p>
      </div>
    );
  }

  const hasMap = !!activity.mapPolyline;
  const hasPower =
    activity.averageWatts != null &&
    (activity.type === "Ride" || activity.type === "VirtualRide");

  return (
    <>
      <PageTitle title={activity.name} />
      <Toolbar actions={<ActivityActionsMenu stravaId={activity.stravaId} />}>
        <Link
          href={backHref}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-lg transition-colors"
        >
          <ArrowLeftIcon className="size-4" />
        </Link>
        <span className="min-w-0 truncate font-semibold">{activity.name}</span>
        <span className="bg-accent text-accent-foreground inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium uppercase">
          {React.createElement(getSportConfig(activity.type).icon, {
            className: "size-3.5",
          })}
          {formatActivityType(activity.type)}
        </span>
        <span className="text-muted-foreground hidden shrink-0 text-sm sm:inline">
          {new Date(activity.startDateLocal).toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </span>
      </Toolbar>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {hasMap && mapExpanded && (
          <div className="bg-background fixed inset-0 z-50 flex flex-col">
            <div className="relative min-h-0 flex-1">
              <ActivityMap
                activity={activity}
                highlightPosition={hoverPosition}
                routePositions={latlngRoute}
              />
              <button
                onClick={() => setMapExpanded(false)}
                className="bg-background/80 hover:bg-background text-foreground absolute right-3 top-3 z-20 flex size-8 items-center justify-center rounded-lg backdrop-blur-sm transition-colors"
                title="Collapse map"
              >
                <Minimize2 className="size-4" />
              </button>
            </div>
            {altitudeData && (
              <ElevationProfile
                altitudeData={altitudeData}
                distanceData={distanceData}
                latlngData={latlngRoute}
                onHoverPositionChange={setHoverPosition}
              />
            )}
          </div>
        )}
        {hasMap && !mapExpanded && (
          <div className="relative h-[50vh] min-h-80 max-h-[600px] w-full">
            <ActivityMap
              activity={activity}
              highlightPosition={hoverPosition}
              routePositions={latlngRoute}
            />
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
        <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-4 p-4 sm:gap-6 sm:p-6 max-sm:px-0">
          <ActivityStats activity={activity} />
          <ActivityStreams
            stravaId={activity.stravaId}
            onHoverPositionChange={setHoverPosition}
            hiddenStreams={hiddenStreams}
          />
          <ActivityLaps
            activityType={activity.type}
            startDate={activity.startDate}
            laps={activity.laps}
            streams={streamsData}
          />
          {hasPower && <PowerCurve stravaId={activity.stravaId} />}
        </div>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────

function ActivityPageSkeleton() {
  return (
    <>
      <Toolbar>
        <div className="bg-accent size-8 animate-pulse rounded-lg" />
        <div className="bg-accent h-6 w-48 animate-pulse rounded" />
        <div className="bg-accent h-5 w-20 animate-pulse rounded-md" />
        <div className="bg-accent h-5 w-40 animate-pulse rounded" />
      </Toolbar>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="bg-secondary h-[50vh] min-h-80 max-h-[600px] w-full animate-pulse" />
        <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-4 p-4 sm:gap-6 sm:p-6 max-sm:px-0">
          <div className="border-border bg-card rounded-sm border max-sm:border-0 p-5">
            <div className="bg-accent mb-4 h-7 w-36 animate-pulse rounded" />
            <div className="border-border mb-4 grid grid-cols-3 gap-2.5 border-b pb-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i}>
                  <div className="bg-accent mb-1 h-3 w-16 animate-pulse rounded" />
                  <div className="bg-accent mt-1 h-8 w-24 animate-pulse rounded" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i}>
                  <div className="bg-accent mb-2 h-3 w-24 animate-pulse rounded" />
                  <div className="grid grid-cols-2 gap-x-2 md:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, j) => (
                      <div key={j}>
                        <div className="bg-accent mb-1 h-3 w-14 animate-pulse rounded" />
                        <div className="bg-accent h-7 w-20 animate-pulse rounded" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-card h-64 animate-pulse rounded-sm" />
          <div className="bg-secondary h-96 animate-pulse rounded-sm" />
        </div>
      </div>
    </>
  );
}

export default ActivityPage;
