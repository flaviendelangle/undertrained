import { useRouter } from "next/router";

import { ActivitiesMap } from "~/components/ActivitiesMap";
import { GpxDropZone } from "~/components/Map/GpxDropZone";
import { MapToolbar } from "~/components/Map/MapToolbar";
import { isRoutesEnabled } from "~/lib/features";
import { NextPageWithLayout } from "~/pages/_app";
import { stashPendingGpx } from "~/utils/pendingGpx";

const HeatmapPage: NextPageWithLayout = () => {
  const router = useRouter();
  return (
    <>
      <MapToolbar section="heatmap" />
      <div className="relative flex-1 overflow-hidden">
        {isRoutesEnabled ? (
          <GpxDropZone
            onDrop={(gpx) => {
              stashPendingGpx(gpx);
              void router.push("/map/new");
            }}
          >
            <ActivitiesMap />
          </GpxDropZone>
        ) : (
          <ActivitiesMap />
        )}
      </div>
    </>
  );
};

export default HeatmapPage;
