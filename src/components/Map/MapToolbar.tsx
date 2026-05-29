import type { ReactNode } from "react";

import { ChevronRightIcon, MapIcon } from "lucide-react";
import Link from "next/link";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

import { Toolbar } from "~/components/settings/SettingsToolbar";
import type { AppMessageKey } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";

import { MapMenu, type MapSection } from "./MapMenu";

type MapToolbarProps = { actions?: ReactNode } & (
  | { section: Exclude<MapSection, "routeDetail">; routeName?: never }
  | { section: "routeDetail"; routeName?: string }
);

export function MapToolbar({ section, routeName, actions }: MapToolbarProps) {
  const t = useT();

  return (
    <Toolbar
      label={t("nav.map")}
      actions={
        <>
          {actions}
          <MapMenu section={section} />
        </>
      }
    >
      <MapIcon className="size-4" />
      <ToolbarPrimitive.Link
        render={
          <Link
            href="/map/heatmap"
            className="hover:text-foreground text-muted-foreground font-semibold"
          />
        }
      >
        {t("nav.map")}
      </ToolbarPrimitive.Link>
      <Breadcrumb section={section} routeName={routeName} />
    </Toolbar>
  );
}

const FLAT_SECTION_TITLES = {
  heatmap: "map.heatmap",
  new: "routes.newRoute",
  routes: "routes.myRoutes",
} as const satisfies Record<Exclude<MapSection, "routeDetail">, AppMessageKey>;

function Breadcrumb({
  section,
  routeName,
}: {
  section: MapSection;
  routeName?: string;
}) {
  const t = useT();
  const separator = (
    <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
  );

  if (section !== "routeDetail") {
    return (
      <>
        {separator}
        <span className="font-semibold">{t(FLAT_SECTION_TITLES[section])}</span>
      </>
    );
  }

  return (
    <>
      {separator}
      <ToolbarPrimitive.Link
        render={
          <Link
            href="/map/routes"
            className="hover:text-foreground text-muted-foreground font-semibold"
          />
        }
      >
        {t("routes.myRoutes")}
      </ToolbarPrimitive.Link>
      {separator}
      <span className="min-w-0 truncate font-semibold">
        {routeName ?? t("routes.editRoute")}
      </span>
    </>
  );
}
