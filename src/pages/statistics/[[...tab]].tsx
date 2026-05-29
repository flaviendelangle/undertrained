import * as React from "react";

import { BarChart3Icon } from "lucide-react";
import nextDynamic from "next/dynamic";

import { SyncPanel } from "~/components/SyncPanel";
import { LoadingOverlay } from "~/components/primitives/LoadingOverlay";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { ChartCardSurfaceProvider } from "~/components/ui/chart-card";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useInitialLoadComplete } from "~/hooks/useInitialLoadComplete";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";
import { getActivityTypesByCategory } from "~/utils/sportConfig";

// Loader per chart, shared between `nextDynamic` (lazy render) and the preload
// effect below (which gates the reveal on the modules being in). Keeping them in
// one place means the two can't drift apart.
const loadFitnessChart = () =>
  import("~/components/charts/FitnessChart").then((m) => m.FitnessChart);
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

const CHART_LOADERS = [
  loadFitnessChart,
  loadActivitiesTimeline,
  loadActivitiesCumulativeTimeline,
  loadPowerCurve,
  loadEddingtonChart,
];

const FitnessChart = nextDynamic(loadFitnessChart, { ssr: false });
const ActivitiesTimeline = nextDynamic(loadActivitiesTimeline, { ssr: false });
const ActivitiesCumulativeTimeline = nextDynamic(
  loadActivitiesCumulativeTimeline,
  { ssr: false },
);
const PowerCurve = nextDynamic(loadPowerCurve, { ssr: false });
const EddingtonChart = nextDynamic(loadEddingtonChart, { ssr: false });

const StatisticsPage: NextPageWithLayout = () => {
  const t = useT();
  // Prefetch the page's primary dataset from the (non-lazy) page itself so the
  // request overlaps with the chart modules loading; the three charts that share
  // this exact key then mount already populated. Harmless on SPA navigation —
  // the cache is warm, so this resolves instantly without a network call.
  useActivitiesQuery({ activityTypes: [] });

  // The reveal long pole differs by entry path: on a fresh load it's the data
  // fetches, but on SPA navigation the data is already cached and the chart
  // *modules* are what we're waiting on. So gate the reveal on the modules being
  // loaded; the hook then reveals once nothing is in flight (instantly when
  // cached, or after the fetches resolve on a fresh load).
  const [modulesReady, setModulesReady] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    void Promise.all(CHART_LOADERS.map((load) => load())).finally(() => {
      if (!cancelled) {
        setModulesReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = useInitialLoadComplete(modulesReady);

  return (
    <>
      <Toolbar label={t("statistics.title")} actions={<SyncPanel />}>
        <BarChart3Icon className="size-4" />
        <span className="font-semibold">{t("statistics.title")}</span>
      </Toolbar>

      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Mobile (< md): charts go full-bleed, flush under the toolbar and
            separated by hairline dividers. Desktop (md+): the familiar centered
            column of boxed cards with gaps. `md` matches useIsMobile. */}
        <div className="flex flex-1 flex-col overflow-y-auto pb-3 md:items-center md:gap-4 md:p-4">
          <ChartCardSurfaceProvider surface="responsive">
            <div className="divide-border border-border flex flex-col divide-y border-b md:w-full md:max-w-5xl md:gap-4 md:divide-y-0 md:border-0">
              <FitnessChart />
              <ActivitiesTimeline />
              <PowerCurve
                activityTypes={getActivityTypesByCategory("cycling")}
              />
              <ActivitiesCumulativeTimeline />
              <EddingtonChart />
            </div>
          </ChartCardSurfaceProvider>
        </div>
        <LoadingOverlay hidden={ready} />
      </div>
    </>
  );
};

export default StatisticsPage;
