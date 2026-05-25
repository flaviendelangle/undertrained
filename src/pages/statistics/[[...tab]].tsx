import * as React from "react";

import { BarChart3Icon } from "lucide-react";
import nextDynamic from "next/dynamic";

import { LoadingOverlay } from "~/components/primitives/LoadingOverlay";
import { PageIntro } from "~/components/primitives/PageIntro";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useInitialLoadComplete } from "~/hooks/useInitialLoadComplete";
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
      <Toolbar>
        <BarChart3Icon className="size-4" />
        <span className="font-semibold">Statistics</span>
      </Toolbar>

      <div className="relative flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto p-3 max-sm:px-0 sm:p-4">
          <div className="flex w-full max-w-5xl flex-col gap-4">
            <PageIntro hintId="intro-statistics-charts">
              Training volume and intensity trends over time. Configure your
              rider settings to see training load data in the charts.
            </PageIntro>
            <FitnessChart />
            <ActivitiesTimeline />
            <ActivitiesCumulativeTimeline />
            <PowerCurve activityTypes={getActivityTypesByCategory("cycling")} />
            <EddingtonChart />
          </div>
        </div>
        <LoadingOverlay hidden={ready} />
      </div>
    </>
  );
};

export const dynamic = "force-dynamic";

export default StatisticsPage;
