import * as React from "react";

import {
  CheckIcon,
  EllipsisIcon,
  FilterIcon,
  FlameIcon,
  PlusIcon,
  RouteIcon,
} from "lucide-react";
import Link from "next/link";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

import { ActivityFilterPanel } from "~/components/settings/ActivityFilterPanel";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
} from "~/components/ui/responsive-dialog";
import { useActivityFilter } from "~/hooks/useActivityFilter";
import { useExplorerTilesToggle } from "~/hooks/useExplorerTilesToggle";
import { type TileStyle, useTileStyle } from "~/hooks/useTileStyle";
import { useT } from "~/i18n/useT";
import { isRoutesEnabled } from "~/lib/features";
import { cn } from "~/lib/utils";

export type MapSection = "heatmap" | "routes" | "new" | "routeDetail";

export function MapMenu({ section }: { section: MapSection }) {
  const t = useT();
  const { showExplorerTiles, setShowExplorerTiles } = useExplorerTilesToggle();
  const { tileStyle, setTileStyle } = useTileStyle();
  const { activeFilterCount } = useActivityFilter();
  const [filterOpen, setFilterOpen] = React.useState(false);

  const hasCustomization =
    showExplorerTiles || tileStyle !== "street" || activeFilterCount > 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <ToolbarPrimitive.Button
              render={
                <Button
                  variant={hasCustomization ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label={t("map.menu")}
                  className={cn(
                    "text-muted-foreground",
                    hasCustomization &&
                      "border-primary/50 text-foreground border",
                  )}
                >
                  <EllipsisIcon className="size-4" />
                </Button>
              }
            />
          }
        />
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuLinkItem
            render={<Link href="/map/heatmap" />}
            aria-current={section === "heatmap" ? "page" : undefined}
          >
            {section === "heatmap" ? (
              <CheckIcon />
            ) : (
              <FlameIcon className="text-muted-foreground" />
            )}
            {t("map.heatmap")}
          </DropdownMenuLinkItem>
          {isRoutesEnabled && (
            <DropdownMenuLinkItem
              render={<Link href="/map/routes" />}
              aria-current={
                section === "routes" || section === "routeDetail"
                  ? "page"
                  : undefined
              }
            >
              {section === "routes" || section === "routeDetail" ? (
                <CheckIcon />
              ) : (
                <RouteIcon className="text-muted-foreground" />
              )}
              {t("routes.myRoutes")}
            </DropdownMenuLinkItem>
          )}
          {isRoutesEnabled && (
            <DropdownMenuLinkItem
              render={<Link href="/map/new" />}
              aria-current={section === "new" ? "page" : undefined}
            >
              {section === "new" ? (
                <CheckIcon />
              ) : (
                <PlusIcon className="text-muted-foreground" />
              )}
              {t("routes.newRoute")}
            </DropdownMenuLinkItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setFilterOpen(true)}>
            <FilterIcon className="text-muted-foreground" />
            <span>{t("settings.filter.trigger")}</span>
            {activeFilterCount > 0 && (
              <span className="bg-primary/20 text-primary-foreground ml-auto rounded px-1 text-xs">
                {activeFilterCount}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={showExplorerTiles}
            onCheckedChange={(checked) => setShowExplorerTiles(checked)}
            closeOnClick={false}
          >
            {t("map.explorerTiles")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {t("map.tileStyle")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
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
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      <ResponsiveDialog open={filterOpen} onOpenChange={setFilterOpen}>
        <ResponsiveDialogContent className="sm:max-w-sm">
          <ActivityFilterPanel />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
