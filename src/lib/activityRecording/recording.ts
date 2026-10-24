import { activityLocalDay } from "~/utils/dateUtils";
import {
  expandToPerSecond,
  perSecondSampleIndices,
} from "~/utils/streamTimeBase";

/** An activity's recorded channels, keyed by Strava stream type. Absent when not recorded. */
export interface RecordingChannels {
  heartrate?: number[];
  watts?: number[];
  cadence?: number[];
  velocity_smooth?: number[];
  altitude?: number[];
  distance?: number[];
  temp?: number[];
  latlng?: [number, number][];
}

export type NumericChannel = Exclude<keyof RecordingChannels, "latlng">;

const NUMERIC_CHANNELS: readonly NumericChannel[] = [
  "heartrate",
  "watts",
  "cadence",
  "velocity_smooth",
  "altitude",
  "distance",
  "temp",
];

export interface ActivityRecording {
  /**
   * One entry per recorded sample, as Strava stores them. For views drawn
   * against distance or position: the map and the elevation profile.
   */
  samples: RecordingChannels;
  /**
   * One entry per second since the start: entry `i` is the latest sample at or
   * before `i` seconds, as server-side scoring expands streams for the power
   * bests. For views drawn against time, and anything that counts seconds.
   */
  perSecond: RecordingChannels;
}

/** Streams as `activityStreams.getStreams` sends them: each one's samples as JSON. */
export type EncodedStreams = readonly { type: string; data: string }[];

/**
 * Decodes an activity's streams. A channel that doesn't decode to an array, or
 * whose length differs from the time stream's, is absent, as if it hadn't been
 * recorded. Without a usable time stream (the server omits a 1 Hz one) every
 * sample counts as one second.
 */
export function decodeRecording(streams: EncodedStreams): ActivityRecording {
  const encoded = new Map(streams.map((s) => [s.type, s.data]));
  const time = decodeTime(encoded.get("time"));

  const decodeChannel = (type: keyof RecordingChannels) => {
    const values = decodeArray(encoded.get(type));
    return values && (!time || values.length === time.length)
      ? values
      : undefined;
  };

  const samples: RecordingChannels = {};
  for (const type of NUMERIC_CHANNELS) {
    samples[type] = decodeChannel(type) as number[] | undefined;
  }
  samples.latlng = decodeChannel("latlng") as [number, number][] | undefined;

  if (!time) {
    return { samples, perSecond: samples };
  }

  const perSecond: RecordingChannels = {};
  for (const type of NUMERIC_CHANNELS) {
    const values = samples[type];
    if (values) perSecond[type] = expandToPerSecond(values, time);
  }
  const { latlng } = samples;
  if (latlng) {
    perSecond.latlng = perSecondSampleIndices(time).map((i) => latlng[i]);
  }

  return { samples, perSecond };
}

/**
 * The day whose rider settings apply to an activity: the calendar day it
 * started on where it was recorded ("YYYY-MM-DD"), which is the day
 * server-side scoring resolves settings for. Its UTC start date can fall on the
 * day before or after.
 */
export function activitySettingsDay(activity: {
  startDateLocal: string;
}): string {
  return activityLocalDay(activity);
}

function decodeArray(data: string | undefined): unknown[] | undefined {
  if (data === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** A time stream is usable when it's whole seconds that never go back. */
function decodeTime(data: string | undefined): number[] | undefined {
  const time = decodeArray(data);
  if (!time || time.length === 0) return undefined;

  let previous = 0;
  for (const t of time) {
    if (!Number.isInteger(t) || (t as number) < previous) return undefined;
    previous = t as number;
  }
  return time as number[];
}
