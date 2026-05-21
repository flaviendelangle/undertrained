import { CalendarDaysIcon } from "lucide-react";
import nextDynamic from "next/dynamic";

import { SyncPanel } from "~/components/SyncPanel";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import type { NextPageWithLayout } from "~/pages/_app";

const Journal = nextDynamic(
  () => import("~/components/journal/Journal").then((m) => m.Journal),
  { ssr: false },
);

const JournalPage: NextPageWithLayout = () => {
  return (
    <>
      <Toolbar actions={<SyncPanel />}>
        <CalendarDaysIcon className="size-4" />
        <span className="font-semibold">Journal</span>
      </Toolbar>

      <div className="flex min-h-0 flex-1 flex-col">
        <Journal />
      </div>
    </>
  );
};

export const dynamic = "force-dynamic";

export default JournalPage;
