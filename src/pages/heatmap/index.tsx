import { GridIcon, MapIcon } from "lucide-react";

import { ActivitiesMap } from "~/components/ActivitiesMap";
import { PageIntro } from "~/components/primitives/PageIntro";
import { ActivityFilterPopover } from "~/components/settings/ActivityFilterPopover";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { Button } from "~/components/ui/button";
import { useExplorerTilesToggle } from "~/hooks/useExplorerTilesToggle";
import { cn } from "~/lib/utils";
import { NextPageWithLayout } from "~/pages/_app";

function ExplorerTilesToggleButton() {
  const { showExplorerTiles, setShowExplorerTiles } = useExplorerTilesToggle();

  return (
    <Button
      variant={showExplorerTiles ? "secondary" : "ghost"}
      size="sm"
      className={cn(
        "text-muted-foreground gap-1.5",
        showExplorerTiles && "border-primary/50 text-foreground border",
      )}
      onClick={() => setShowExplorerTiles((prev) => !prev)}
    >
      <GridIcon className="size-3.5" />
      <span>Tiles</span>
    </Button>
  );
}

const HeatmapPage: NextPageWithLayout = () => {
  return (
    <>
      <Toolbar
        actions={
          <>
            <ActivityFilterPopover />
            <ExplorerTilesToggleButton />
          </>
        }
      >
        <MapIcon className="size-4" />
        <span className="font-semibold">Heatmap</span>
      </Toolbar>
      <div className="relative flex-1 overflow-hidden">
        <ActivitiesMap />
        <PageIntro hintId="intro-heatmap" className="pointer-events-auto absolute top-3 right-3 left-3 z-10 shadow-lg sm:top-4 sm:right-4 sm:left-4">
          All your GPS activities plotted on a map. Toggle <strong>Tiles</strong> to overlay an exploration grid that tracks which areas you&apos;ve covered.
        </PageIntro>
      </div>
    </>
  );
};

export const dynamic = "force-dynamic";

export default HeatmapPage;
