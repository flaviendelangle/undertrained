import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";

import { RouteBuilder } from "~/components/routes/RouteBuilder";
import { RouteToolbar } from "~/components/routes/RouteToolbar";
import { SendToDeviceMenu } from "~/components/routes/SendToDeviceMenu";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import { isRoutesEnabled } from "~/lib/features";
import type { NextPageWithLayout } from "~/pages/_app";
import { decode } from "~/utils/polyline";
import { trpc } from "~/utils/trpc";

export const getServerSideProps: GetServerSideProps = async () => {
  if (!isRoutesEnabled) return { notFound: true };
  return { props: {} };
};

const EditRoutePage: NextPageWithLayout = () => {
  const t = useT();
  const router = useRouter();
  const athleteId = useAthleteId();
  const routeId = Number(router.query.routeId);

  const { data: route, isLoading } = trpc.routes.get.useQuery(
    { athleteId, id: routeId },
    { enabled: Number.isFinite(routeId) },
  );

  return (
    <>
      <RouteToolbar
        title={route?.name ?? t("routes.editRoute")}
        actions={
          route && (
            <SendToDeviceMenu
              inToolbar
              name={route.name}
              sport={route.sport}
              points={decode(route.mapPolyline)}
              elevation={[]}
              distance={route.distance}
            />
          )
        }
      />
      <div className="relative flex-1 overflow-hidden">
        {route ? (
          // Remount on id change so the builder re-seeds its state from the route.
          <RouteBuilder key={route.id} route={route} />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            {isLoading ? t("common.loading") : t("routes.notFound")}
          </div>
        )}
      </div>
    </>
  );
};

export default EditRoutePage;
