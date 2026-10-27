import * as React from "react";

import { ActivityIcon, FlagIcon, ListIcon } from "lucide-react";
import { useRouter } from "next/router";

import { ActivityActionsMenu } from "~/components/ActivityActionsMenu";
import { ActivityStats } from "~/components/ActivityStats";
import { EditActivityButton } from "~/components/EditActivityDialog";
import { PageTitle } from "~/components/PageTitle";
import { ActivityRouteExplorer } from "~/components/activity/ActivityRouteExplorer";
import { ActivityLaps } from "~/components/charts/ActivityLaps";
import { ActivityStreams } from "~/components/charts/ActivityStreams";
import { PaceCard } from "~/components/charts/PaceCard";
import { ActivityPersonalRecords } from "~/components/charts/PersonalRecords/ActivityPersonalRecords";
import { PowerCurve } from "~/components/charts/PowerCurve";
import { PageToolbar } from "~/components/layouts/PageToolbar";
import { ChartCardSurfaceProvider } from "~/components/ui/chart-card";
import { useActivityView } from "~/hooks/useActivityView";
import { useRememberRecentItem } from "~/hooks/useRememberRecentItem";
import { useTypedParams } from "~/hooks/useTypedParams";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { useActivityRecording } from "~/lib/activityRecording";
import {
  type RecordingSegment,
  type SegmentSelectionPhase,
  recordingSegment,
} from "~/lib/activityRecording/segment";
import { NextPageWithLayout } from "~/pages/_app";
import { readReturnTo } from "~/utils/activityLinks";
import { isRoutePosition } from "~/utils/routeGeometry";
import {
  getSportConfig,
  supportsAnalysis,
  workoutKind,
} from "~/utils/sportConfig";
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
      <ActivityPageContent key={stravaId} stravaId={stravaId} />
    </React.Suspense>
  );
};

function ActivityPageContent({ stravaId }: { stravaId: number }) {
  const t = useT();
  const router = useRouter();
  const scope = useActivityView();
  const backHref = readReturnTo(router.query) ?? scope.href("/activities");

  const [hoverTime, setHoverTime] = React.useState<number | null>(null);
  const [pinnedTime, setPinnedTime] = React.useState<number | null>(null);
  const [segment, setSegment] = React.useState<RecordingSegment | null>(null);
  const [segmentPhase, setSegmentPhase] =
    React.useState<SegmentSelectionPhase>("preview");
  const cursorTime = hoverTime ?? pinnedTime;
  const pinTime = React.useCallback((time: number) => {
    setHoverTime(null);
    setPinnedTime(time);
  }, []);
  const [activity] = trpc.activities.get.useSuspenseQuery({ stravaId });
  const { recording } = useActivityRecording(stravaId);
  const [inspectionRecording, setInspectionRecording] =
    React.useState(recording);
  if (inspectionRecording !== recording) {
    setInspectionRecording(recording);
    setSegment(null);
    setSegmentPhase("preview");
    setHoverTime(null);
    setPinnedTime(null);
  }
  useRememberRecentItem(
    activity && {
      kind: "activity",
      id: activity.stravaId,
      name: activity.name,
      type: activity.type,
      startDateLocal: activity.startDateLocal,
    },
  );
  const selectSegment = React.useCallback(
    (value: RecordingSegment, phase: SegmentSelectionPhase = "commit") => {
      if (!recording) return;
      const next = recordingSegment(recording, ...value);
      setSegment(next);
      setSegmentPhase(next ? phase : "preview");
    },
    [recording],
  );
  const clearInspection = React.useCallback(() => {
    setSegment(null);
    setSegmentPhase("preview");
    setHoverTime(null);
    setPinnedTime(null);
  }, []);

  const hiddenStreams = React.useMemo(() => {
    if (!activity) return [];
    const hidden: string[] = [];
    if (activity.distance === 0) hidden.push("velocity_smooth");
    if (activity.totalElevationGain === 0) hidden.push("altitude");
    return hidden;
  }, [activity]);

  if (!activity) {
    return (
      <>
        <PageToolbar
          title={t("activities.pageTitle")}
          icon={ListIcon}
          backHref={backHref}
        />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">{t("activities.notFound")}</p>
        </div>
      </>
    );
  }

  const hasMap =
    !!activity.mapPolyline ||
    !!recording?.samples.latlng?.some(isRoutePosition);
  const isRace = workoutKind(activity.workoutType) === "race";
  const hasNotes = !!activity.description || !!activity.privateNote;
  const hasPower =
    activity.powerBests != null &&
    Object.keys(activity.powerBests).length > 0 &&
    supportsAnalysis(activity.type, "power");
  // Pace card: running activities that covered distance (so a speed stream is
  // expected — same assumption the hidden-streams logic above makes). The card
  // reads the stream itself and shows its own loading/empty states.
  const hasPace =
    supportsAnalysis(activity.type, "pace") && activity.distance > 0;

  return (
    <>
      <PageTitle title={activity.name} />
      <PageToolbar
        title={activity.name}
        icon={getSportConfig(activity.type).icon}
        backHref={backHref}
        actions={
          <>
            <EditActivityButton activity={activity} />
            <ActivityActionsMenu stravaId={activity.stravaId} />
          </>
        }
      >
        <span className="bg-accent text-accent-foreground hidden shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium uppercase sm:inline-flex">
          {React.createElement(getSportConfig(activity.type).icon, {
            className: "size-3.5",
          })}
          {sportTypeLabel(activity.type, t)}
        </span>
        {isRace && (
          <span className="hidden shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium text-amber-500 uppercase ring-1 ring-amber-400/80 ring-inset sm:inline-flex">
            <FlagIcon className="size-3" />
            {t("activities.race")}
          </span>
        )}
        {activity.commute && (
          <span className="bg-accent text-muted-foreground hidden shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium uppercase sm:inline-flex">
            {t("activities.commute")}
          </span>
        )}
        <span className="text-muted-foreground hidden shrink-0 text-sm sm:inline">
          {new Date(activity.startDateLocal).toLocaleDateString(
            getActiveDateLocale().code,
            {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            },
          )}
        </span>
      </PageToolbar>

      <div className="border-border flex flex-wrap items-center gap-1.5 border-b px-4 py-2 sm:hidden">
        <span className="bg-accent text-accent-foreground inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium uppercase">
          {React.createElement(getSportConfig(activity.type).icon, {
            className: "size-3.5",
          })}
          {sportTypeLabel(activity.type, t)}
        </span>
        {isRace && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium text-amber-500 uppercase ring-1 ring-amber-400/80 ring-inset">
            <FlagIcon className="size-3" />
            {t("activities.race")}
          </span>
        )}
        {activity.commute && (
          <span className="bg-accent text-muted-foreground inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium uppercase">
            {t("activities.commute")}
          </span>
        )}
        <span className="text-muted-foreground text-xs">
          {new Date(activity.startDateLocal).toLocaleDateString(
            getActiveDateLocale().code,
            {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            },
          )}
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {hasMap && (
          <ActivityRouteExplorer
            activity={activity}
            recording={recording}
            cursorTime={cursorTime}
            segment={segment}
            segmentPhase={segmentPhase}
            onCursorChange={setHoverTime}
            onPinTime={pinTime}
            onSegmentChange={selectSegment}
            onClear={clearInspection}
          />
        )}
        {/* Below the map: full-bleed cards on mobile (hairline dividers), then
            boxed cards centered on desktop — matching the Statistics page. */}
        <ChartCardSurfaceProvider surface="responsive">
          <div className="divide-border border-border flex w-full flex-col divide-y border-b md:mx-auto md:max-w-7xl md:gap-6 md:divide-y-0 md:border-0 md:p-6">
            <ActivityStats activity={activity} />
            {hasNotes && (
              <div className="md:border-border md:bg-card flex flex-col gap-4 p-5 md:rounded-sm md:border">
                {activity.description && (
                  <div>
                    <div className="text-muted-foreground mb-1 text-xs font-medium">
                      {t("activities.description")}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">
                      {activity.description}
                    </p>
                  </div>
                )}
                {activity.privateNote && (
                  <div>
                    <div className="text-muted-foreground mb-1 text-xs font-medium">
                      {t("activities.privateNote")}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">
                      {activity.privateNote}
                    </p>
                  </div>
                )}
              </div>
            )}
            <ActivityStreams
              stravaId={activity.stravaId}
              cursorTime={cursorTime}
              selectedSegment={segment}
              onHoverTimeChange={setHoverTime}
              onInspectTime={pinTime}
              onSegmentChange={selectSegment}
              onClear={clearInspection}
              hiddenStreams={hiddenStreams}
            />
            <ActivityLaps
              activityType={activity.type}
              startDateLocal={activity.startDateLocal}
              laps={activity.laps}
            />
            {hasPower && <PowerCurve stravaId={activity.stravaId} />}
            {hasPace && <PaceCard stravaId={activity.stravaId} />}
            <ActivityPersonalRecords
              stravaId={activity.stravaId}
              activityType={activity.type}
            />
          </div>
        </ChartCardSurfaceProvider>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────

function ActivityPageSkeleton() {
  const t = useT();
  return (
    <>
      <PageToolbar title={t("common.loading")} icon={ActivityIcon} />

      <div className="border-border flex items-center gap-1.5 border-b px-4 py-2 sm:hidden">
        <div className="bg-accent h-5 w-20 animate-pulse rounded-md" />
        <div className="bg-accent h-4 w-32 animate-pulse rounded" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="bg-secondary h-[50vh] max-h-[600px] min-h-80 w-full animate-pulse" />
        <div className="divide-border border-border flex w-full flex-col divide-y border-b md:mx-auto md:max-w-7xl md:gap-6 md:divide-y-0 md:border-0 md:p-6">
          <div className="md:border-border md:bg-card p-5 md:rounded-sm md:border">
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
          <div className="bg-card h-64 animate-pulse md:rounded-sm" />
          <div className="bg-secondary h-96 animate-pulse md:rounded-sm" />
        </div>
      </div>
    </>
  );
}

export default ActivityPage;
