import { TrophyIcon } from "lucide-react";
import nextDynamic from "next/dynamic";

import { PageToolbar } from "~/components/layouts/PageToolbar";
import { LoadingOverlay } from "~/components/primitives/LoadingOverlay";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useInitialLoadComplete } from "~/hooks/useInitialLoadComplete";
import { useModuleLoaded } from "~/hooks/useModuleLoaded";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";
import { trpc } from "~/utils/trpc";

const loadRecords = () =>
  import("~/components/charts/Records/Records").then((m) => m.Records);

const Records = nextDynamic(loadRecords, { ssr: false });

const RecordsPage: NextPageWithLayout = () => {
  const t = useT();
  const athleteId = useAthleteId();
  trpc.records.getOptions.useQuery({ athleteId });

  const moduleReady = useModuleLoaded(loadRecords);

  const ready = useInitialLoadComplete(moduleReady, 10000, [
    "records.getOptions",
    "records.getCyclingPowerLeaderboard",
    "records.getCyclingSpeedLeaderboard",
    "records.getCyclingElevationLeaderboard",
    "records.getRunEffortLeaderboard",
    "records.getHeartrateLeaderboard",
    "records.getLongestActivityLeaderboard",
  ]);

  return (
    <>
      <PageToolbar title={t("nav.personalBests")} icon={TrophyIcon} />

      {/* Records renders its own toolbar above the scrolling leaderboard. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <Records />
        <LoadingOverlay hidden={ready} />
      </div>
    </>
  );
};

export default RecordsPage;
