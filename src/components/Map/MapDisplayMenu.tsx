import { SlidersHorizontalIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useExplorerTilesToggle } from "~/hooks/useExplorerTilesToggle";
import { type TileStyle, useTileStyle } from "~/hooks/useTileStyle";
import { useT } from "~/i18n/useT";

export function MapDisplayMenu() {
  const t = useT();
  const { showExplorerTiles, setShowExplorerTiles } = useExplorerTilesToggle();
  const { tileStyle, setTileStyle } = useTileStyle();
  return (
    <div className="absolute top-4 right-4 z-[1000]">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              className="bg-background shadow-md"
              aria-label={t("map.menu")}
            />
          }
        >
          <SlidersHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuCheckboxItem
            checked={showExplorerTiles}
            onCheckedChange={setShowExplorerTiles}
            closeOnClick={false}
          >
            {t("map.explorerTiles")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <div className="text-muted-foreground px-2 py-1 text-xs">
            {t("map.tileStyle")}
          </div>
          <DropdownMenuRadioGroup
            value={tileStyle}
            onValueChange={(value) => setTileStyle(value as TileStyle)}
          >
            <DropdownMenuRadioItem value="street">
              {t("map.style.street")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="satellite">
              {t("map.style.satellite")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
