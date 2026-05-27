import * as React from "react";

import { TrophyIcon } from "lucide-react";
import nextDynamic from "next/dynamic";

import { SyncPanel } from "~/components/SyncPanel";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import type { NextPageWithLayout } from "~/pages/_app";

const Records = nextDynamic(
  () => import("~/components/charts/Records/Records").then((m) => m.Records),
  { ssr: false },
);

const RecordsPage: NextPageWithLayout = () => {
  return (
    <>
      <Toolbar actions={<SyncPanel />}>
        <TrophyIcon className="size-4" />
        <span className="font-semibold">Personal bests</span>
      </Toolbar>

      <div className="flex flex-1 flex-col overflow-y-auto p-3 sm:p-6 max-sm:px-0">
        <div className="mx-auto w-full max-w-6xl">
          <Records />
        </div>
      </div>
    </>
  );
};

export default RecordsPage;
