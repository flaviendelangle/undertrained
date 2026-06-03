import * as React from "react";

import {
  ExternalLinkIcon,
  FileDownIcon,
  SendIcon,
  UploadIcon,
} from "lucide-react";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useT } from "~/i18n/useT";
import { buildGpx, downloadFile } from "~/utils/gpx";
import type { LatLngTuple } from "~/utils/polyline";
import type { RouteSport } from "~/utils/routeProfiles";

const PLATFORMS = [
  { id: "garmin", url: "https://connect.garmin.com/modern/courses" },
  { id: "wahoo", url: "https://www.wahoofitness.com/" },
  { id: "komoot", url: "https://www.komoot.com/plan" },
  { id: "rwgps", url: "https://ridewithgps.com/routes/new" },
  { id: "strava", url: "https://www.strava.com/routes/new" },
] as const;

interface SendToDeviceMenuProps {
  name: string;
  sport: RouteSport;
  points: LatLngTuple[];
  /** Per-point elevation in meters, or [] when unknown. */
  elevation: number[];
  /** Total distance in meters. */
  distance: number;
  /**
   * Render the trigger as a Toolbar item — required when the menu lives inside
   * a `<Toolbar>` (e.g. MapToolbar actions slot) so focus/roving keyboard
   * navigation work. Plain `<Button>` otherwise.
   */
  inToolbar?: boolean;
  /** Compact icon-only trigger (for table rows / cards). */
  iconOnly?: boolean;
}

export function SendToDeviceMenu({
  name,
  sport,
  points,
  elevation,
  distance,
  inToolbar,
  iconOnly,
}: SendToDeviceMenuProps) {
  const t = useT();
  const safe = (name || t("routes.defaultName")).trim();
  const filenameBase = (safe || "route").replace(/[^\w-]+/g, "_");
  const disabled = points.length < 2;

  const onDownloadGpx = () => {
    const xml = buildGpx(safe, points, elevation);
    downloadFile(`${filenameBase}.gpx`, xml, "application/gpx+xml");
  };

  // The FIT writer (@markw65/fit-file-writer, ~2.6M) is only needed when the
  // user actually exports a .fit — load it on demand so it stays out of the
  // route-builder's initial chunk.
  const onDownloadFit = async () => {
    const [{ buildFitCourse }, { downloadFitFile }] = await Promise.all([
      import("~/utils/fitCourse"),
      import("~/utils/fitFileGenerator"),
    ]);
    const buffer = buildFitCourse({
      name: safe,
      sport,
      points,
      elevation,
      distance,
    });
    downloadFitFile(buffer, `${filenameBase}.fit`);
  };

  const triggerButton = (
    <Button
      variant="outline"
      size={iconOnly ? "icon-sm" : "sm"}
      disabled={disabled}
      aria-label={iconOnly ? t("routes.send.trigger") : undefined}
    >
      <SendIcon />
      {!iconOnly && t("routes.send.trigger")}
    </Button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          inToolbar ? (
            <ToolbarPrimitive.Button render={triggerButton} />
          ) : (
            triggerButton
          )
        }
      />
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem onClick={onDownloadGpx}>
          <FileDownIcon />
          {t("routes.send.downloadGpx")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void onDownloadFit()}>
          <FileDownIcon />
          {t("routes.send.downloadFit")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("routes.send.uploadTo")}</DropdownMenuLabel>
          {PLATFORMS.map((p) => (
            <DropdownMenuSub key={p.id}>
              <DropdownMenuSubTrigger>
                <UploadIcon />
                {t(`routes.send.platforms.${p.id}.label`)}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-w-72">
                <p className="text-muted-foreground px-2 py-1.5 text-xs leading-snug">
                  {t(`routes.send.platforms.${p.id}.instructions`)}
                </p>
                <DropdownMenuLinkItem
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLinkIcon />
                  {t(`routes.send.platforms.${p.id}.label`)}
                </DropdownMenuLinkItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
