import * as React from "react";

import { BarChart3Icon } from "lucide-react";
import nextDynamic from "next/dynamic";
import { useRouter } from "next/router";

import { PageIntro } from "~/components/primitives/PageIntro";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import type { NextPageWithLayout } from "~/pages/_app";
import { getActivityTypesByCategory } from "~/utils/sportConfig";

const ActivitiesTimeline = nextDynamic(
  () =>
    import("~/components/charts/ActivitiesTimeline").then(
      (m) => m.ActivitiesTimeline,
    ),
  { ssr: false },
);
const ActivitiesCumulativeTimeline = nextDynamic(
  () =>
    import("~/components/charts/ActivitiesCumulativeTimeline").then(
      (m) => m.ActivitiesCumulativeTimeline,
    ),
  { ssr: false },
);
const PowerCurve = nextDynamic(
  () => import("~/components/charts/PowerCurve").then((m) => m.PowerCurve),
  { ssr: false },
);
const EddingtonChart = nextDynamic(
  () =>
    import("~/components/charts/EddingtonChart").then((m) => m.EddingtonChart),
  { ssr: false },
);
const Records = nextDynamic(
  () => import("~/components/charts/Records/Records"),
  { ssr: false },
);

const StatisticsPage: NextPageWithLayout = () => {
  const router = useRouter();

  // Redirect old /statistics/periods to /periods
  React.useEffect(() => {
    if (!router.isReady) return;
    const rawTab = Array.isArray(router.query.tab)
      ? router.query.tab[0]
      : undefined;
    if (rawTab === "periods") {
      void router.replace("/periods");
    }
  }, [router]);

  return (
    <>
      <Toolbar>
        <BarChart3Icon className="size-4" />
        <span className="font-semibold">Statistics</span>
      </Toolbar>

      <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto p-3 sm:p-4">
        <div className="flex w-full max-w-5xl flex-col gap-4">
          <PageIntro hintId="intro-statistics-charts">
            Training volume and intensity trends over time. Configure your rider
            settings to see training load data in the charts.
          </PageIntro>
          <ActivitiesTimeline />
          <ActivitiesCumulativeTimeline />
          <PowerCurve activityTypes={getActivityTypesByCategory("cycling")} />
          <EddingtonChart />
          <Records />
        </div>
      </div>
    </>
  );
};

export const dynamic = "force-dynamic";

export default StatisticsPage;
