import { useQuery } from "@tanstack/react-query";

import { useAthleteId } from "~/hooks/useAthleteId";
import { trpc } from "~/utils/trpc";

import {
  type ActivityRecording,
  type EncodedStreams,
  decodeRecording,
} from "./recording";

export interface ActivityRecordingResult {
  /** The decoded streams; null while they're being fetched from Strava. */
  recording: ActivityRecording | null;
  /** Why fetching the streams from Strava failed, if it did. */
  error: string | null;
}

/** For an activity whose Strava fetch found nothing this page can chart. */
const EMPTY_RECORDING: ActivityRecording = { samples: {}, perSecond: {} };

// Every card on the activity page reads the same query data: decode each
// payload once, not once per card.
const decodedStreams = new WeakMap<EncodedStreams, ActivityRecording>();

function decode(streams: EncodedStreams): ActivityRecording {
  let recording = decodedStreams.get(streams);
  if (!recording) {
    recording = decodeRecording(streams);
    decodedStreams.set(streams, recording);
  }
  return recording;
}

/**
 * An activity's decoded streams. Suspends until the stored streams are read.
 * Activities synced without their streams get them from Strava the first time
 * any component reads them; every reader shares that one fetch.
 */
export function useActivityRecording(
  stravaId: number,
): ActivityRecordingResult {
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();
  const [streams] = trpc.activityStreams.getStreams.useSuspenseQuery({
    stravaId,
  });

  // A query rather than a mutation, so React Query runs it once per activity
  // however many components read the recording, and shares its outcome.
  const stravaFetch = useQuery({
    queryKey: ["activityRecording", "fetchFromStrava", stravaId, athleteId],
    enabled: streams === null,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      await utils.client.activityStreams.fetchStreams.mutate({
        stravaId,
        athleteId,
      });
      // Storing the streams also rescored the activity.
      await Promise.all([
        utils.activityStreams.getStreams.invalidate({ stravaId }),
        utils.activities.get.invalidate({ stravaId }),
      ]);
      return null;
    },
  });

  if (streams) {
    return { recording: decode(streams), error: null };
  }
  if (stravaFetch.isError) {
    return { recording: null, error: String(stravaFetch.error) };
  }
  return {
    recording: stravaFetch.isSuccess ? EMPTY_RECORDING : null,
    error: null,
  };
}
