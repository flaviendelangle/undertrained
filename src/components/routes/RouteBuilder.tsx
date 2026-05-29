import * as React from "react";

import {
  LocateFixedIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { useRouter } from "next/router";

import { GpxDropZone } from "~/components/Map/GpxDropZone";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useAthleteId } from "~/hooks/useAthleteId";
import type { AppMessageKey } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import type { Route } from "@server/db/types";
import { formatKm } from "~/utils/format";
import {
  elevationAscent,
  type ParsedGpx,
  polylineDistance,
} from "~/utils/gpx";
import { takePendingGpx } from "~/utils/pendingGpx";
import { decode, encode, type LatLngTuple } from "~/utils/polyline";
import {
  DEFAULT_PROFILE_BY_SPORT,
  ROUTE_PROFILES,
  type RouteSport,
} from "~/utils/routeProfiles";
import { trpc } from "~/utils/trpc";

import { ElevationProfile } from "./ElevationProfile";
import { RouteBuilderMap } from "./LazyRouteBuilderMap";
import { SendToDeviceMenu } from "./SendToDeviceMenu";

// Picked to stay well under the 50-waypoint ORS cap while keeping enough
// anchors for the re-snapped route to roughly trace an imported GPX.
const GPX_WAYPOINT_COUNT = 12;

/** Evenly-spaced subsample by index; returns the input as-is when shorter than `count`. */
function sampleWaypoints(
  points: LatLngTuple[],
  count: number,
): LatLngTuple[] {
  if (points.length <= count) return points;
  const result: LatLngTuple[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i / (count - 1)) * (points.length - 1));
    result.push(points[idx]);
  }
  return result;
}

/** Translation keys for each ORS routing profile (labels live in routeProfiles). */
const PROFILE_LABEL_KEY: Record<string, AppMessageKey> = {
  "cycling-regular": "routes.profile.cyclingRegular",
  "cycling-road": "routes.profile.cyclingRoad",
  "cycling-mountain": "routes.profile.cyclingMountain",
  "foot-walking": "routes.profile.footWalking",
  "foot-hiking": "routes.profile.footHiking",
};

interface PreviewData {
  encodedPolyline: string;
  points: LatLngTuple[];
  elevation: number[];
  /** ORS geometry index of each anchor; maps a line grab to a segment. */
  wayPoints: number[];
  distance: number; // meters
  ascent: number; // meters
}

export function RouteBuilder({ route }: { route?: Route }) {
  const t = useT();
  const athleteId = useAthleteId();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [name, setName] = React.useState(route?.name ?? "");
  const [sport, setSport] = React.useState<RouteSport>(
    (route?.sport as RouteSport) ?? "cycling",
  );
  const [profile, setProfile] = React.useState(
    route?.profile ?? DEFAULT_PROFILE_BY_SPORT.cycling,
  );
  const [waypoints, setWaypoints] = React.useState<LatLngTuple[]>(
    route?.waypoints ?? [],
  );
  // Snapshots of `waypoints` before each edit, so Undo reverts the last action
  // (add / move / insert / delete / clear) — not just the last-added point.
  const [history, setHistory] = React.useState<LatLngTuple[][]>([]);
  const [preview, setPreview] = React.useState<PreviewData | null>(
    route
      ? {
          encodedPolyline: route.mapPolyline,
          points: decode(route.mapPolyline),
          elevation: [],
          wayPoints: [],
          distance: route.distance,
          ascent: route.elevationGain ?? 0,
        }
      : null,
  );

  const previewMutation = trpc.routes.preview.useMutation();
  const createMutation = trpc.routes.create.useMutation({
    onSuccess: () => {
      void utils.routes.list.invalidate();
      void router.push("/map/routes");
    },
  });
  const updateMutation = trpc.routes.update.useMutation({
    onSuccess: () => {
      void utils.routes.invalidate();
      void router.push("/map/routes");
    },
  });

  // Snap to roads whenever the anchors or profile change (debounced). We keep
  // the previous geometry on screen until the new snap returns to avoid flicker.
  // After loading a GPX, the first snap is skipped so the imported geometry
  // stays visible until the user explicitly edits a waypoint.
  const skipNextSnapRef = React.useRef(false);
  const mutate = previewMutation.mutate;
  React.useEffect(() => {
    if (!athleteId || waypoints.length < 2) {
      return;
    }
    if (skipNextSnapRef.current) {
      skipNextSnapRef.current = false;
      return;
    }
    const handle = setTimeout(() => {
      mutate(
        { athleteId, profile, waypoints },
        {
          onSuccess: (data) =>
            setPreview({
              encodedPolyline: data.encodedPolyline,
              points: data.points,
              elevation: data.elevation,
              wayPoints: data.wayPoints,
              distance: data.distance,
              ascent: data.ascent,
            }),
        },
      );
    }, 400);
    return () => clearTimeout(handle);
  }, [athleteId, profile, waypoints, mutate]);

  // Bumped on every GPX load to force the map to re-fit to the new geometry.
  // The fit must always happen on a drop, even mid-edit, so the user sees
  // the route they just imported.
  const [fitToken, setFitToken] = React.useState(0);

  const loadFromGpx = React.useCallback((gpx: ParsedGpx) => {
    if (gpx.points.length < 2) return;
    const sampled = sampleWaypoints(gpx.points, GPX_WAYPOINT_COUNT);
    const distance = polylineDistance(gpx.points);
    const ascent = gpx.elevation ? elevationAscent(gpx.elevation) : 0;
    skipNextSnapRef.current = true;
    setHistory([]);
    setWaypoints(sampled);
    setPreview({
      encodedPolyline: encode(gpx.points),
      points: gpx.points,
      elevation: gpx.elevation ?? [],
      wayPoints: [],
      distance,
      ascent,
    });
    if (gpx.name) setName(gpx.name);
    setFitToken((token) => token + 1);
  }, []);

  // Confirm before replacing any existing route geometry (saved or in-progress).
  // Dropping a GPX over a drawn route is easy to do by accident and discards
  // the prior shape with no undo.
  const [pendingDroppedGpx, setPendingDroppedGpx] =
    React.useState<ParsedGpx | null>(null);
  const handleGpxDrop = React.useCallback(
    (gpx: ParsedGpx) => {
      if (waypoints.length > 0) {
        setPendingDroppedGpx(gpx);
      } else {
        loadFromGpx(gpx);
      }
    },
    [waypoints.length, loadFromGpx],
  );

  // If a GPX was stashed by the heatmap before navigating here, load it now.
  // Editing a saved route ignores any pending stash — the saved route wins.
  React.useEffect(() => {
    if (route) return;
    const gpx = takePendingGpx();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (gpx) loadFromGpx(gpx);
  }, [route, loadFromGpx]);

  const handleSportChange = (next: RouteSport) => {
    setSport(next);
    setProfile(DEFAULT_PROFILE_BY_SPORT[next]);
  };

  // Apply an edit while recording the prior state for Undo (capped to bound
  // memory). Every user action funnels through here so each is one undo step.
  const MAX_HISTORY = 200;
  const commitWaypoints = (next: LatLngTuple[]) => {
    setHistory((h) => [...h, waypoints].slice(-MAX_HISTORY));
    setWaypoints(next);
  };

  const undo = () => {
    if (history.length === 0) return;
    setWaypoints(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
  };
  const clear = () => {
    if (waypoints.length === 0) return;
    commitWaypoints([]);
    setPreview(null);
  };

  // Below two anchors there's no route; ignore any stale snap left in state.
  const activePreview = waypoints.length >= 2 ? preview : null;

  // Index hovered on the elevation profile → highlighted point on the map. The
  // elevation array and route geometry share indices (both from ORS coords).
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  const highlightPosition =
    activePreview && hoverIndex != null
      ? (activePreview.points[hoverIndex] ?? null)
      : null;

  const canSave =
    !!athleteId && name.trim().length > 0 && !!activePreview;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const save = () => {
    if (!athleteId || !activePreview) return;
    const payload = {
      athleteId,
      name: name.trim(),
      sport,
      profile,
      waypoints,
      mapPolyline: activePreview.encodedPolyline,
      distance: activePreview.distance,
      elevationGain: activePreview.ascent || null,
    };
    if (route) {
      updateMutation.mutate({ ...payload, id: route.id });
    } else {
      createMutation.mutate(payload);
    }
  };

  const profilesForSport = ROUTE_PROFILES.filter((p) => p.sport === sport);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Map */}
      <div className="relative min-h-[45vh] flex-1 md:min-h-0">
        <GpxDropZone onDrop={handleGpxDrop}>
          <RouteBuilderMap
            waypoints={waypoints}
            routePoints={activePreview?.points ?? null}
            routeWayPoints={activePreview?.wayPoints ?? null}
            highlightPosition={highlightPosition}
            fitToken={fitToken}
            onAddWaypoint={(p) => commitWaypoints([...waypoints, p])}
            onMoveWaypoint={(i, p) =>
              commitWaypoints(waypoints.map((w, idx) => (idx === i ? p : w)))
            }
            onInsertWaypoint={(i, p) =>
              commitWaypoints([...waypoints.slice(0, i), p, ...waypoints.slice(i)])
            }
            onRemoveWaypoint={(i) =>
              commitWaypoints(waypoints.filter((_, idx) => idx !== i))
            }
          />
          {previewMutation.isPending && (
            <div className="bg-background/90 text-muted-foreground absolute top-3 left-3 z-400 rounded-md px-2.5 py-1 text-xs shadow">
              {t("routes.routing")}
            </div>
          )}
        </GpxDropZone>
      </div>

      <ResponsiveDialog
        open={pendingDroppedGpx != null}
        onOpenChange={(open) => {
          if (!open) setPendingDroppedGpx(null);
        }}
      >
        <ResponsiveDialogContent className="sm:max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t("routes.replaceGpxTitle")}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t("routes.replaceGpxBody")}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDroppedGpx(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (pendingDroppedGpx) loadFromGpx(pendingDroppedGpx);
                setPendingDroppedGpx(null);
              }}
            >
              {t("routes.replaceGpxConfirm")}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Side panel */}
      <div className="border-border flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t p-4 md:w-80 md:border-t-0 md:border-l">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <LocateFixedIcon className="size-3.5" />
          {t("routes.dropPointsHint")}
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("routes.name")}</Label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("routes.namePlaceholder")}
            className="border-border bg-background h-9 rounded-md border px-3 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label>{t("routes.sport")}</Label>
            <Select
              value={sport}
              onValueChange={(v) => handleSportChange(v as RouteSport)}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue>
                  {sport === "cycling"
                    ? t("sport.cycling.label")
                    : t("sport.running.label")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cycling">{t("sport.cycling.label")}</SelectItem>
                <SelectItem value="running">{t("sport.running.label")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("routes.profileLabel")}</Label>
            <Select
              value={profile}
              onValueChange={(v) => v && setProfile(v)}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue>
                  {PROFILE_LABEL_KEY[profile]
                    ? t(PROFILE_LABEL_KEY[profile])
                    : profile}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {profilesForSport.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {PROFILE_LABEL_KEY[p.value]
                      ? t(PROFILE_LABEL_KEY[p.value])
                      : p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Stats */}
        <div className="bg-muted/40 grid grid-cols-2 gap-2 rounded-md p-3 text-sm">
          <div>
            <div className="text-muted-foreground text-xs">{t("routes.distance")}</div>
            <div className="font-semibold">
              {activePreview ? formatKm(activePreview.distance) : "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">{t("routes.elevationGain")}</div>
            <div className="font-semibold">
              {activePreview ? `${Math.round(activePreview.ascent)} m` : "—"}
            </div>
          </div>
        </div>

        {activePreview && activePreview.elevation.length > 1 && (
          <ElevationProfile
            elevation={activePreview.elevation}
            hoverIndex={hoverIndex}
            onHoverIndexChange={setHoverIndex}
          />
        )}

        {previewMutation.error && (
          <p className="text-destructive text-xs">
            {previewMutation.error.message}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={undo}
            disabled={history.length === 0}
          >
            <RotateCcwIcon /> {t("routes.undo")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={clear}
            disabled={waypoints.length === 0}
          >
            <Trash2Icon /> {t("routes.clear")}
          </Button>
          <SendToDeviceMenu
            name={name}
            sport={sport}
            points={activePreview?.points ?? []}
            elevation={activePreview?.elevation ?? []}
            distance={activePreview?.distance ?? 0}
          />
        </div>

        <Button onClick={save} disabled={!canSave || isSaving} className="mt-auto">
          <SaveIcon />
          {isSaving
            ? t("routes.saving")
            : route
              ? t("routes.updateRoute")
              : t("routes.saveRoute")}
        </Button>
      </div>
    </div>
  );
}
