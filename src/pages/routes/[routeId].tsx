import type { GetServerSideProps } from "next";
import { RouteIcon } from "lucide-react";
import { useRouter } from "next/router";

import { RouteBuilder } from "~/components/routes/RouteBuilder";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { useAthleteId } from "~/hooks/useAthleteId";
import { isRoutesEnabled } from "~/lib/features";
import type { NextPageWithLayout } from "~/pages/_app";
import { trpc } from "~/utils/trpc";

export const getServerSideProps: GetServerSideProps = async () => {
  if (!isRoutesEnabled) return { notFound: true };
  return { props: {} };
};

const EditRoutePage: NextPageWithLayout = () => {
  const router = useRouter();
  const athleteId = useAthleteId();
  const routeId = Number(router.query.routeId);

  const { data: route, isLoading } = trpc.routes.get.useQuery(
    { athleteId: athleteId!, id: routeId },
    { enabled: !!athleteId && Number.isFinite(routeId) },
  );

  return (
    <>
      <Toolbar>
        <RouteIcon className="size-4" />
        <span className="font-semibold">{route?.name ?? "Edit route"}</span>
      </Toolbar>
      <div className="relative flex-1 overflow-hidden">
        {route ? (
          // Remount on id change so the builder re-seeds its state from the route.
          <RouteBuilder key={route.id} route={route} />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            {isLoading ? "Loading…" : "Route not found."}
          </div>
        )}
      </div>
    </>
  );
};

export default EditRoutePage;
