import { useRouter } from "next/router";

import { ActivitiesMap } from "~/components/ActivitiesMap";
import { GpxDropZone } from "~/components/Map/GpxDropZone";
import { MapDisplayMenu } from "~/components/Map/MapDisplayMenu";
import { ActivityWorkspaceToolbar } from "~/components/views/ActivityWorkspaceToolbar";
import {
  ActivityViewBoundary,
  SharedViewBar,
} from "~/components/views/SharedViewBar";
import { isRoutesEnabled } from "~/lib/features";
import { NextPageWithLayout } from "~/pages/_app";
import { stashPendingGpx } from "~/utils/pendingGpx";

const HeatmapPage: NextPageWithLayout = () => {
  const router = useRouter();
  return (
    <>
      <ActivityWorkspaceToolbar presentation="map" />
      <SharedViewBar />
      <ActivityViewBoundary>
        <div className="relative isolate flex-1 overflow-hidden">
          {isRoutesEnabled ? (
            <GpxDropZone
              onDrop={(gpx) => {
                stashPendingGpx(gpx);
                void router.push("/routes/new");
              }}
            >
              <ActivitiesMap />
            </GpxDropZone>
          ) : (
            <ActivitiesMap />
          )}
          <MapDisplayMenu />
        </div>
      </ActivityViewBoundary>
    </>
  );
};

export default HeatmapPage;
