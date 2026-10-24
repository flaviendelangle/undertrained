/**
 * An activity's recording, as the activity page charts it.
 *
 * Loads the streams (fetching them from Strava the first time if sync didn't),
 * decodes them, and puts them on the per-second time base server-side scoring
 * expands sparse streams onto, so the page counts seconds the way the stored
 * power bests do. Also picks the day whose rider settings apply to the
 * activity, the same day scoring uses.
 *
 * Charts take decoded channels; the streams payload's shape stays in here.
 */

export { activitySettingsDay } from "./recording";
export type {
  ActivityRecording,
  NumericChannel,
  RecordingChannels,
} from "./recording";
export { useActivityRecording } from "./useActivityRecording";
export type { ActivityRecordingResult } from "./useActivityRecording";
