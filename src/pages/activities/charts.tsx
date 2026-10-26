import nextDynamic from "next/dynamic";

import { LoadingOverlay } from "~/components/primitives/LoadingOverlay";
import { QueryState } from "~/components/primitives/QueryState";
import { ChartCardSurfaceProvider } from "~/components/ui/chart-card";
import { ActivityWorkspaceToolbar } from "~/components/views/ActivityWorkspaceToolbar";
import {
  ActivityViewBoundary,
  SharedViewBar,
} from "~/components/views/SharedViewBar";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useInitialLoadComplete } from "~/hooks/useInitialLoadComplete";
import { useModuleLoaded } from "~/hooks/useModuleLoaded";
import type { NextPageWithLayout } from "~/pages/_app";
import { activityTypesFor } from "~/utils/sportConfig";

// Loader per chart, shared between `nextDynamic` (lazy render) and the preload
// effect below (which gates the reveal on the modules being in). Keeping them in
// one place means the two can't drift apart.
const loadActivitiesTimeline = () =>
  import("~/components/charts/ActivitiesTimeline").then(
    (m) => m.ActivitiesTimeline,
  );
const loadActivitiesCumulativeTimeline = () =>
  import("~/components/charts/ActivitiesCumulativeTimeline").then(
    (m) => m.ActivitiesCumulativeTimeline,
  );
const loadPowerCurve = () =>
  import("~/components/charts/PowerCurve").then((m) => m.PowerCurve);
const loadEddingtonChart = () =>
  import("~/components/charts/EddingtonChart").then((m) => m.EddingtonChart);
const loadTimeInZones = () =>
  import("~/components/charts/TimeInZones").then((m) => m.TimeInZones);

const loadCharts = () =>
  Promise.all([
    loadActivitiesTimeline(),
    loadTimeInZones(),
    loadActivitiesCumulativeTimeline(),
    loadPowerCurve(),
    loadEddingtonChart(),
  ]);

const ActivitiesTimeline = nextDynamic(loadActivitiesTimeline, { ssr: false });
const ActivitiesCumulativeTimeline = nextDynamic(
  loadActivitiesCumulativeTimeline,
  { ssr: false },
);
const PowerCurve = nextDynamic(loadPowerCurve, { ssr: false });
const EddingtonChart = nextDynamic(loadEddingtonChart, { ssr: false });
const TimeInZones = nextDynamic(loadTimeInZones, { ssr: false });

const POWER_ACTIVITY_TYPES = activityTypesFor("power");

const StatisticsPage: NextPageWithLayout = () => {
  // Prefetch the page's primary dataset from the (non-lazy) page itself so the
  // request overlaps with the chart modules loading; the three charts that share
  // this exact key then mount already populated. Harmless on SPA navigation —
  // the cache is warm, so this resolves instantly without a network call.
  const activitiesQuery = useActivitiesQuery("statistics");

  // Overlap module loading with data, then reveal without waiting for optional
  // analytics, record badges, or calendar feeds.
  const modulesReady = useModuleLoaded(loadCharts);

  const ready = useInitialLoadComplete(modulesReady, 10000, [
    "activities.list",
    "riderSettings.get",
  ]);

  return (
    <>
      <ActivityWorkspaceToolbar presentation="charts" />

      <SharedViewBar />
      <ActivityViewBoundary>
        {activitiesQuery.isError ? (
          <QueryState error onRetry={() => void activitiesQuery.refetch()} />
        ) : (
          <div className="relative flex flex-1 flex-col overflow-hidden">
            {/* Mobile (< md): charts go full-bleed, flush under the toolbar and
            separated by hairline dividers. Desktop (md+): the familiar centered
            column of boxed cards with gaps. `md` matches useIsMobile. */}
            <div className="flex flex-1 flex-col overflow-y-auto pb-3 md:items-center md:gap-4 md:p-4">
              <ChartCardSurfaceProvider surface="responsive">
                <div className="divide-border border-border flex flex-col divide-y border-b md:w-full md:max-w-5xl md:gap-4 md:divide-y-0 md:border-0">
                  <ActivitiesTimeline />
                  <PowerCurve activityTypes={POWER_ACTIVITY_TYPES} />
                  <TimeInZones />
                  <ActivitiesCumulativeTimeline />
                  <EddingtonChart />
                </div>
              </ChartCardSurfaceProvider>
            </div>
            <LoadingOverlay hidden={ready} />
          </div>
        )}
      </ActivityViewBoundary>
    </>
  );
};

export default StatisticsPage;
