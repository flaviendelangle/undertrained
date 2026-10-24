// @vitest-environment happy-dom
import * as React from "react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { computePaceZoneDistribution } from "~/components/charts/PaceCard/paceDistribution";
import { computePowerZoneDistribution } from "~/components/charts/PowerCurve/powerDistribution";
import { DEFAULT_RIDER_SETTINGS_TIMELINE } from "~/sensors/types";
import { scoreActivity } from "~/server/lib/activityScoring";
import { resolveRiderSettings } from "~/utils/resolveRiderSettings";

import { activitySettingsDay, useActivityRecording } from ".";

type EncodedStreams = { type: string; data: string }[];

/** A fake `activityStreams` backend: what's stored per activity, and Strava. */
const backend = vi.hoisted(() => ({
  stored: new Map<number, EncodedStreams | null>(),
  fetchStreams: vi.fn(),
}));

vi.mock("~/hooks/useAthleteId", () => ({ useAthleteId: () => 7 }));
vi.mock("~/utils/trpc", async () => {
  const { useQueryClient, useSuspenseQuery } =
    await import("@tanstack/react-query");
  const streamsKey = (stravaId: number) => ["streams", stravaId];
  return {
    trpc: {
      activityStreams: {
        getStreams: {
          useSuspenseQuery: ({ stravaId }: { stravaId: number }) => {
            const query = useSuspenseQuery({
              queryKey: streamsKey(stravaId),
              queryFn: () => backend.stored.get(stravaId) ?? null,
            });
            return [query.data, query];
          },
        },
      },
      useUtils: () => {
        const client = useQueryClient();
        return {
          client: {
            activityStreams: { fetchStreams: { mutate: backend.fetchStreams } },
          },
          activityStreams: {
            getStreams: {
              invalidate: ({ stravaId }: { stravaId: number }) =>
                client.invalidateQueries({ queryKey: streamsKey(stravaId) }),
            },
          },
          activities: { get: { invalidate: () => Promise.resolve() } },
        };
      },
    },
  };
});

/** Encodes streams the way the server sends them; strings pass through as raw (possibly bad) data. */
function encode(streams: Record<string, unknown>): EncodedStreams {
  return Object.entries(streams).map(([type, data]) => ({
    type,
    data: typeof data === "string" ? data : JSON.stringify(data),
  }));
}

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <React.Suspense fallback={null}>{children}</React.Suspense>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  backend.stored.clear();
  backend.fetchStreams.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

/** Renders a component reading activity 1's recording. */
async function readRecording() {
  const { result } = renderHook(() => useActivityRecording(1), { wrapper });
  // Let the suspended first read settle inside `act`.
  await act(() => Promise.resolve());
  return result;
}

/** The recording of activity 1, stored as `streams`. */
async function loadRecording(streams: Record<string, unknown>) {
  backend.stored.set(1, encode(streams));
  return (await readRecording()).current.recording!;
}

describe("decoding", () => {
  it("drops channels that aren't arrays and reads a recording without time as 1 Hz", async () => {
    const recording = await loadRecording({
      heartrate: [120, 121, 122],
      watts: "[100, 200", // truncated JSON
      cadence: '{"not": "an array"}',
      latlng: [
        [45, 5],
        [45.1, 5.1],
        [45.2, 5.2],
      ],
    });

    expect(recording.samples).toEqual({
      heartrate: [120, 121, 122],
      latlng: [
        [45, 5],
        [45.1, 5.1],
        [45.2, 5.2],
      ],
    });
    expect(recording.perSecond).toEqual(recording.samples);
  });

  it.each([
    { problem: "is truncated", time: "[0, 1" },
    { problem: "goes back", time: [0, 2, 1] },
    { problem: "isn't whole seconds", time: [0, 1.5, 3] },
  ])(
    "reads the samples as 1 Hz when the time stream $problem",
    async ({ time }) => {
      const recording = await loadRecording({ time, watts: [100, 200, 300] });
      expect(recording.perSecond.watts).toEqual([100, 200, 300]);
    },
  );
});

describe("time base", () => {
  it("holds each sparse sample until the next one, on every channel", async () => {
    const recording = await loadRecording({
      time: [0, 3, 4],
      watts: [100, 200, 300],
      distance: [0, 24, 32],
      latlng: [
        [45, 5],
        [45.1, 5.1],
        [45.2, 5.2],
      ],
      heartrate: [120, 130], // one sample short of the time stream
    });

    expect(recording.perSecond).toEqual({
      watts: [100, 100, 100, 200, 300],
      distance: [0, 0, 0, 24, 32],
      latlng: [
        [45, 5],
        [45, 5],
        [45, 5],
        [45.1, 5.1],
        [45.2, 5.2],
      ],
    });
    // The map and elevation profile keep the samples as recorded.
    expect(recording.samples.distance).toEqual([0, 24, 32]);
  });

  it("matches the server's zone seconds on a smart-recorded workout", async () => {
    // Smart recording samples sparsely while the effort holds and adds a
    // sample a second either side of each change. The server's zone pass
    // credits a gap to the sample after it, the per-second time base (like the
    // stored power bests) to the sample before; with 1 s gaps around every
    // change, both put the same seconds in each zone.
    const time = [0, 3, 6, 9, 10, 13, 16, 17, 20, 21, 26, 31];
    const watts = [150, 150, 150, 150, 320, 320, 320, 0, 0, 150, 150, 150];
    const speeds = [3, 3, 3, 3, 4.5, 4.5, 4.5, 0, 0, 3.5, 3.5, 3.5];
    const ftp = 250;
    const thresholdSpeed = 4;

    const recording = await loadRecording({
      time,
      watts,
      velocity_smooth: speeds,
    });
    // Power zones apply to rides and pace zones to runs.
    const serverZones = (type: string) =>
      scoreActivity({
        activity: {
          type,
          startDateLocal: "2026-01-01T08:00:00Z",
          movingTime: 31,
          distance: 0,
          weightedAverageWatts: null,
        },
        streams: { time, watts, velocity_smooth: speeds },
        riderSettings: {
          initialValues: { ftp, runThresholdPace: thresholdSpeed },
          changes: [],
        },
      }).zoneSeconds;
    const ride = serverZones("Ride");
    const run = serverZones("Run");

    const power = computePowerZoneDistribution(recording.perSecond.watts!, ftp);
    expect(power[0].seconds).toBe(ride?.powerCoastingSeconds);
    expect(power.slice(1).map((zone) => zone.seconds)).toEqual(ride?.power);
    const pace = computePaceZoneDistribution(
      recording.perSecond.velocity_smooth!,
      thresholdSpeed,
    );
    expect(pace.map((zone) => zone.seconds)).toEqual(run?.pace);
    // Each sample counted as one second would put 12 s in the zones, not 32.
    expect(power.reduce((sum, zone) => sum + zone.seconds, 0)).toBe(32);
  });
});

describe("loading", () => {
  it("fetches missing streams from Strava once for every reader", async () => {
    backend.stored.set(1, null);
    let finishFetch!: () => void;
    const fetched = new Promise<void>((resolve) => (finishFetch = resolve));
    backend.fetchStreams.mockImplementation(async () => {
      await fetched;
      backend.stored.set(1, encode({ watts: [100, 200] }));
    });

    const readers = [await readRecording(), await readRecording()];
    expect(readers.map((reader) => reader.current)).toEqual([
      { recording: null, error: null },
      { recording: null, error: null },
    ]);

    act(() => finishFetch());
    for (const reader of readers) {
      await waitFor(() =>
        expect(reader.current.recording?.perSecond.watts).toEqual([100, 200]),
      );
    }
    expect(backend.fetchStreams).toHaveBeenCalledTimes(1);
    expect(backend.fetchStreams).toHaveBeenCalledWith({
      stravaId: 1,
      athleteId: 7,
    });
  });

  it("reports a failed Strava fetch", async () => {
    backend.stored.set(1, null);
    backend.fetchStreams.mockRejectedValue(
      new Error("Streams not found on Strava"),
    );

    const result = await readRecording();

    await waitFor(() =>
      expect(result.current.error).toBe("Error: Streams not found on Strava"),
    );
    expect(result.current.recording).toBeNull();
  });
});

describe("activitySettingsDay", () => {
  const timeline = {
    ...DEFAULT_RIDER_SETTINGS_TIMELINE,
    changes: [{ id: "ftp-test", date: "2026-03-05", ftp: 280 }],
  };

  it.each([
    {
      when: "just after midnight east of UTC",
      activity: {
        startDate: "2026-03-04T23:30:00Z",
        startDateLocal: "2026-03-05T00:30:00Z",
      },
      ftp: 280,
    },
    {
      when: "just before midnight west of UTC",
      activity: {
        startDate: "2026-03-05T04:30:00Z",
        startDateLocal: "2026-03-04T23:30:00Z",
      },
      ftp: DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues.ftp,
    },
  ])(
    "uses the settings of the local start day for an activity $when",
    ({ activity, ftp }) => {
      expect(
        resolveRiderSettings(timeline, activitySettingsDay(activity)).ftp,
      ).toBe(ftp);
    },
  );
});
