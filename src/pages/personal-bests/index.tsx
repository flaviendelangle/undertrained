import * as React from "react";

import { TrophyIcon } from "lucide-react";
import nextDynamic from "next/dynamic";

import { SyncPanel } from "~/components/SyncPanel";
import { LoadingOverlay } from "~/components/primitives/LoadingOverlay";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useInitialLoadComplete } from "~/hooks/useInitialLoadComplete";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";
import { trpc } from "~/utils/trpc";

const loadRecords = () =>
  import("~/components/charts/Records/Records").then((m) => m.Records);

const Records = nextDynamic(loadRecords, { ssr: false });

const RecordsPage: NextPageWithLayout = () => {
  const t = useT();
  const athleteId = useAthleteId();
  trpc.records.getOptions.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );

  const [moduleReady, setModuleReady] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    void loadRecords().finally(() => {
      if (!cancelled) {
        setModuleReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      <Toolbar label={t("nav.personalBests")} actions={<SyncPanel />}>
        <TrophyIcon className="size-4" />
        <span className="font-semibold">{t("nav.personalBests")}</span>
      </Toolbar>

      <div className="relative flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 flex-col overflow-y-auto p-3 max-sm:px-0 sm:p-6">
          <div className="mx-auto w-full max-w-6xl">
            <Records />
          </div>
        </div>
        <LoadingOverlay hidden={ready} />
      </div>
    </>
  );
};

export default RecordsPage;
