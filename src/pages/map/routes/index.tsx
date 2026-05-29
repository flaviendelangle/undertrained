import * as React from "react";

import type { GetServerSideProps } from "next";
import { PlusIcon, RouteIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";

import { Map } from "~/components/Map";
import { MapToolbar } from "~/components/Map/MapToolbar";
import { SendToDeviceMenu } from "~/components/routes/SendToDeviceMenu";
import { Button } from "~/components/ui/button";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import { isRoutesEnabled } from "~/lib/features";
import type { NextPageWithLayout } from "~/pages/_app";
import { decode } from "~/utils/polyline";
import type { RouteSport } from "~/utils/routeProfiles";
import { trpc } from "~/utils/trpc";

// Routes is opt-in (see next.config.ts). When disabled, a direct visit 404s.
export const getServerSideProps: GetServerSideProps = async () => {
  if (!isRoutesEnabled) return { notFound: true };
  return { props: {} };
};

function RouteCard({
  route,
  onDelete,
}: {
  route: {
    id: number;
    name: string;
    sport: string;
    distance: number;
    elevationGain: number | null;
    mapPolyline: string;
  };
  onDelete: (id: number) => void;
}) {
  const t = useT();
  const positions = React.useMemo(
    () => decode(route.mapPolyline),
    [route.mapPolyline],
  );

  return (
    <div className="border-border bg-card flex flex-col overflow-hidden rounded-lg border">
      <Link href={`/map/routes/${route.id}`} className="block h-36 w-full">
        <Map
          activities={null}
          routePositions={positions}
          dragging={false}
          zoomControl={false}
        />
      </Link>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <Link
            href={`/map/routes/${route.id}`}
            className="hover:text-primary block truncate text-sm font-medium"
          >
            {route.name}
          </Link>
          <div className="text-muted-foreground text-xs">
            {(route.distance / 1000).toFixed(1)} km
            {route.elevationGain != null &&
              ` · ${Math.round(route.elevationGain)} m`}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <SendToDeviceMenu
            iconOnly
            name={route.name}
            sport={route.sport as RouteSport}
            points={positions}
            elevation={[]}
            distance={route.distance}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("routes.deleteRoute")}
            onClick={() => onDelete(route.id)}
          >
            <Trash2Icon className="text-muted-foreground size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

const RoutesPage: NextPageWithLayout = () => {
  const t = useT();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();

  const { data: routes } = trpc.routes.list.useQuery(
    { athleteId: athleteId! },
    { enabled: !!athleteId },
  );

  const deleteMutation = trpc.routes.delete.useMutation({
    onSuccess: () => utils.routes.list.invalidate(),
  });

  const onDelete = (id: number) => {
    if (!athleteId) return;
    deleteMutation.mutate({ athleteId, id });
  };

  return (
    <>
      <MapToolbar section="routes" />

      <div className="relative flex-1 overflow-y-auto p-3 sm:p-4">
        {routes?.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-3 py-16 text-center text-sm">
            <RouteIcon className="size-8 opacity-50" />
            <p>{t("routes.empty")}</p>
            <Button size="sm" nativeButton={false} render={<Link href="/map/new" />}>
              <PlusIcon /> {t("routes.createFirst")}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {routes?.map((route) => (
              <RouteCard key={route.id} route={route} onDelete={onDelete} />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default RoutesPage;
