import * as React from "react";

import { CalendarDaysIcon } from "lucide-react";
import nextDynamic from "next/dynamic";

import { SyncPanel } from "~/components/SyncPanel";
import { LoadingOverlay } from "~/components/primitives/LoadingOverlay";
import { ActivityFilterPopover } from "~/components/settings/ActivityFilterPopover";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useInitialLoadComplete } from "~/hooks/useInitialLoadComplete";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";

// Shared loader for `nextDynamic` (lazy render) and the preload effect below
// (which gates the reveal on the module being in), so the two can't drift apart.
const loadJournal = () =>
  import("~/components/journal/Journal").then((m) => m.Journal);

const Journal = nextDynamic(loadJournal, { ssr: false });

const JournalPage: NextPageWithLayout = () => {
  const t = useT();
  // Prefetch the journal's primary dataset from the (non-lazy) page itself so
  // the request overlaps with the Journal module loading; the component then
  // mounts already populated. Harmless on SPA navigation — the cache is warm,
  // so this resolves instantly without a network call.
  useActivitiesQuery();

  // The reveal long pole differs by entry path: on a fresh load it's the data
  // fetches, but on SPA navigation the data is already cached and the Journal
  // *module* is what we're waiting on. So gate the reveal on the module being
  // loaded; the hook then reveals once nothing is in flight (instantly when
  // cached, or after the fetches resolve on a fresh load).
  const [moduleReady, setModuleReady] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    void loadJournal().finally(() => {
      if (!cancelled) {
        setModuleReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = useInitialLoadComplete(moduleReady);

  return (
    <>
      <Toolbar
        label={t("nav.journal")}
        actions={
          <>
            <ActivityFilterPopover />
            <SyncPanel />
          </>
        }
      >
        <CalendarDaysIcon className="size-4" />
        <span className="font-semibold">{t("nav.journal")}</span>
      </Toolbar>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <Journal />
        <LoadingOverlay hidden={ready} />
      </div>
    </>
  );
};

export default JournalPage;
