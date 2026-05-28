import { GridIcon, MapIcon } from "lucide-react";

import { ActivitiesMap } from "~/components/ActivitiesMap";
import { ActivityFilterPopover } from "~/components/settings/ActivityFilterPopover";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { Button } from "~/components/ui/button";
import { useExplorerTilesToggle } from "~/hooks/useExplorerTilesToggle";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { NextPageWithLayout } from "~/pages/_app";

function ExplorerTilesToggleButton() {
  const t = useT();
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
      <span>{t("map.tiles")}</span>
    </Button>
  );
}

const MapPage: NextPageWithLayout = () => {
  const t = useT();
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
        <span className="font-semibold">{t("nav.map")}</span>
      </Toolbar>
      <div className="relative flex-1 overflow-hidden">
        <ActivitiesMap />
      </div>
    </>
  );
};

export default MapPage;
