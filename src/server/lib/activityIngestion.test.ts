import { beforeEach, describe, expect, it, vi } from "vitest";

import { createActivityIngestion } from "./activityIngestion";
import type { ActivityIngestion } from "./activityIngestion";
import {
  InMemoryActivityStore,
  InMemoryStrava,
} from "./activityIngestion.testing";
import type { ScoringRiderSettings } from "./activityScoring";
import { StravaError } from "./stravaPort";
import type { ActivityStream, StravaDetailedActivity } from "./stravaPort";

const ATHLETE = 7;
const JOB = 1;

const SETTINGS: ScoringRiderSettings = {
  initialValues: {
    ftp: 250,
    weightKg: 70,
    restingHr: 50,
    maxHr: 190,
    lthr: 170,
    runThresholdPace: 4, // m/s
    swimThresholdPace: 1, // m/s
  },
  changes: [],
};

function stream(type: string, data: number[]): ActivityStream {
  return {
    type,
    seriesType: "time",
    originalSize: data.length,
    resolution: "high",
    data,
  };
}

const TIME = stream("time", [0, 600, 1200, 1800, 2400, 3000, 3599]);
const HEARTRATE = stream("heartrate", [120, 140, 150, 155, 160, 150, 130]);

function rideStreams(watts: number) {
  return [TIME, HEARTRATE, stream("watts", Array<number>(7).fill(watts))];
}

const RUN_STREAMS = [
  TIME,
  HEARTRATE,
  stream("velocity_smooth", [3.5, 3.6, 3.4, 3.5, 3.7, 3.6, 3.5]),
];

/** A one-hour ride with power; each test overrides what it's about. */
function ride(
  id: number,
  overrides: Partial<StravaDetailedActivity> = {},
): StravaDetailedActivity {
  return {
    id,
    athlete: { id: 12345 },
    type: "Ride",
    name: "Morning ride",
    start_date: "2026-05-10T07:00:00Z",
    start_date_local: "2026-05-10T09:00:00Z",
    distance: 30000,
    total_elevation_gain: 300,
    average_speed: 8.3,
    average_watts: 180,
    weighted_average_watts: 200,
    moving_time: 3600,
    elapsed_time: 3700,
    workout_type: 12,
    commute: false,
    calories: 800,
    description: "Legs ok",
    laps: [
      {
        lap_index: 1,
        name: "Lap 1",
        start_index: 0,
        end_index: 6,
        elapsed_time: 3700,
        distance: 30000,
        average_speed: 8.3,
        average_watts: 180,
      },
    ],
    ...overrides,
  };
}

function run(id: number): StravaDetailedActivity {
  return {
    ...ride(id),
    type: "Run",
    name: "Lunch run",
    distance: 12500,
    average_speed: 3.5,
    average_watts: undefined,
    weighted_average_watts: undefined,
    workout_type: 0,
    calories: 650,
    description: "Easy",
    best_efforts: [
      {
        id: 900,
        name: "1k",
        distance: 1000,
        elapsed_time: 280,
        moving_time: 280,
        pr_rank: 1,
        start_date: "2026-05-10T07:10:00Z",
      },
    ],
  };
}

/** A pool swim entered by hand: Strava has no streams for it. */
function swim(
  id: number,
  overrides: Partial<StravaDetailedActivity> = {},
): StravaDetailedActivity {
  return {
    ...ride(id),
    type: "Swim",
    name: "Pool",
    distance: 1500,
    average_speed: 0.83,
    moving_time: 1800,
    elapsed_time: 2000,
    average_watts: undefined,
    weighted_average_watts: undefined,
    workout_type: undefined,
    calories: 400,
    description: "4x375",
    laps: [],
    ...overrides,
  };
}

function rateLimited() {
  return new StravaError("rate_limited", "Rate Limit Exceeded", {
    retryAfterMs: 60_000,
  });
}

let store: InMemoryActivityStore;
let strava: InMemoryStrava;
let sleeps: number[];
let ingestion: ActivityIngestion;

beforeEach(() => {
  store = new InMemoryActivityStore();
  strava = new InMemoryStrava();
  sleeps = [];
  ingestion = createActivityIngestion({
    store,
    strava,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  store.riderSettings.set(ATHLETE, SETTINGS);
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation(() => undefined);
  }
});

/** Runs a `load_missing` sync job to the end. */
async function sync() {
  store.seedSyncJob({
    id: JOB,
    athlete: ATHLETE,
    status: "fetching_activities",
    mode: "load_missing",
  });
  await ingestion.runSync(ATHLETE, JOB, "load_missing");
  return store.syncJobs.get(JOB);
}

/** The per-activity requests, leaving out the history pages and stats. */
function activityCalls() {
  return strava.calls.filter(
    (call) => call.startsWith("getStreams") || call.startsWith("getActivity"),
  );
}

describe("webhook create", () => {
  it("stores the activity with its streams, details, best efforts and scores", async () => {
    strava.put(ATHLETE, run(1), RUN_STREAMS);
    await ingestion.activityCreated(ATHLETE, 1);

    const row = store.activity(1);
    expect(row).toMatchObject({
      type: "Run",
      startDate: "2026-05-10T07:00:00Z",
      calories: 650,
      description: "Easy",
      areStreamsLoaded: true,
      areDetailsLoaded: true,
    });
    expect(row.laps).toHaveLength(1);
    expect(store.streams.get(row.id)).toEqual(RUN_STREAMS);
    expect(store.bestEfforts.get(row.id)).toEqual([
      expect.objectContaining({ name: "1k", elapsedTime: 280 }),
    ]);
    // rTSS needs the velocity stream, so scoring ran after the streams landed.
    expect(row.tss).toEqual(expect.any(Number));
    expect(row.heartrateBests).not.toBeNull();
    expect(store.athleteStats.get(ATHLETE)).toBe(strava.stats);
  });

  it("still stores the details and scores when Strava has no streams", async () => {
    strava.put(ATHLETE, swim(2));
    await ingestion.activityCreated(ATHLETE, 2);

    const row = store.activity(2);
    expect(row).toMatchObject({
      areStreamsLoaded: true,
      streamFetchAttempts: 0,
      areDetailsLoaded: true,
      description: "4x375",
      tss: expect.any(Number) as unknown,
    });
    expect(store.streams.get(row.id)).toEqual([]);
  });

  it("counts a failed stream fetch and still stores the details and scores", async () => {
    strava.put(ATHLETE, ride(3), rideStreams(200));
    strava.failNext("getStreams", new StravaError("other", "Bad Gateway"));
    await ingestion.activityCreated(ATHLETE, 3);

    expect(store.activity(3)).toMatchObject({
      areStreamsLoaded: false,
      streamFetchAttempts: 1,
      areDetailsLoaded: true,
      description: "Legs ok",
      tss: expect.any(Number) as unknown,
    });
  });
});

describe("webhook update", () => {
  beforeEach(async () => {
    strava.put(ATHLETE, ride(4), rideStreams(100));
    await ingestion.activityCreated(ATHLETE, 4);
    strava.calls.length = 0;
  });

  it.each([
    ["distance", { distance: 29000 }],
    ["moving time", { moving_time: 3400 }],
    ["elapsed time", { elapsed_time: 3900 }],
    ["average watts", { average_watts: 175 }],
    ["weighted average watts", { weighted_average_watts: 210 }],
  ])(
    "re-fetches the streams and re-scores when Strava changed the %s",
    async (_, change) => {
      const before = store.activity(4).powerBests;
      const recomputed = rideStreams(300);
      strava.put(ATHLETE, ride(4, change), recomputed);
      await ingestion.activityUpdated(ATHLETE, 4);

      const row = store.activity(4);
      expect(activityCalls()).toEqual(["getActivity 4", "getStreams 4"]);
      expect(store.streams.get(row.id)).toBe(recomputed);
      expect(row.areStreamsLoaded).toBe(true);
      expect(row.powerBests).not.toEqual(before);
    },
  );

  it("keeps the streams when only the metadata changed", async () => {
    const stored = store.streams.get(store.activity(4).id);
    strava.put(
      ATHLETE,
      ride(4, {
        name: "Commute home",
        commute: true,
        workout_type: undefined,
        description: "Edited",
      }),
      rideStreams(300),
    );
    await ingestion.activityUpdated(ATHLETE, 4);

    expect(activityCalls()).toEqual(["getActivity 4"]);
    expect(store.streams.get(store.activity(4).id)).toBe(stored);
    expect(store.activity(4)).toMatchObject({
      name: "Commute home",
      commute: true,
      workoutType: null,
      description: "Edited",
    });
  });

  it("ignores an activity we don't store", async () => {
    strava.put(ATHLETE, ride(5));
    await ingestion.activityUpdated(ATHLETE, 5);

    expect(strava.calls).toEqual([]);
    expect(store.activities).toHaveLength(1);
  });
});

describe("sync", () => {
  it("imports a page of history and fetches what each activity lacks", async () => {
    strava.put(ATHLETE, run(10), RUN_STREAMS);
    strava.put(ATHLETE, swim(11));

    expect(await sync()).toMatchObject({
      status: "completed",
      activitiesFetched: 2,
      activitiesPagesComplete: true,
      streamsTotal: 2,
      streamsFetched: 2,
    });

    const runRow = store.activity(10);
    expect(runRow).toMatchObject({
      startDate: "2026-05-10T07:00:00Z",
      // Only the detailed activity carries calories.
      calories: 650,
      areStreamsLoaded: true,
      areDetailsLoaded: true,
      tss: expect.any(Number) as unknown,
    });
    expect(store.bestEfforts.get(runRow.id)).toHaveLength(1);
    expect(store.activity(11)).toMatchObject({
      areStreamsLoaded: true,
      areDetailsLoaded: true,
      tss: expect.any(Number) as unknown,
    });
    expect(store.athleteStats.get(ATHLETE)).toBe(strava.stats);
  });

  it("re-fetches only the activities whose metrics changed on Strava", async () => {
    strava.put(ATHLETE, ride(20), rideStreams(100));
    strava.put(ATHLETE, ride(21), rideStreams(100));
    await ingestion.activityCreated(ATHLETE, 20);
    await ingestion.activityCreated(ATHLETE, 21);
    strava.calls.length = 0;

    strava.put(ATHLETE, ride(20, { average_watts: 190 }), rideStreams(300));
    // A time-zone fix and a rename: metadata only.
    strava.put(
      ATHLETE,
      ride(21, { start_date: "2026-05-10T06:00:00Z", name: "Renamed" }),
      rideStreams(300),
    );

    expect(await sync()).toMatchObject({
      status: "completed",
      streamsTotal: 1,
      streamsFetched: 1,
    });
    expect(activityCalls()).toEqual(["getStreams 20", "getActivity 20"]);
    expect(store.activity(20).averageWatts).toBe(190);
    expect(store.activity(21)).toMatchObject({
      name: "Renamed",
      startDate: "2026-05-10T06:00:00Z",
      // The page summary lacks calories; the stored ones stay.
      calories: 800,
    });
  });

  it("gives up on an activity's streams after three failed fetches", async () => {
    strava.put(ATHLETE, ride(30), rideStreams(200));
    strava.failNext("getStreams", new StravaError("other", "Bad Gateway"), 3);

    expect(await sync()).toMatchObject({ status: "completed" });
    expect(store.activity(30)).toMatchObject({
      areStreamsLoaded: false,
      streamFetchAttempts: 3,
      areDetailsLoaded: true,
    });
  });
});

describe("manual reload", () => {
  it("reloads an activity Strava has no streams for", async () => {
    strava.put(ATHLETE, swim(40));
    await ingestion.activityCreated(ATHLETE, 40);
    strava.put(ATHLETE, swim(40, { name: "Pool, edited", commute: true }));

    await expect(ingestion.reloadActivity(ATHLETE, 40)).resolves.toBe(true);
    expect(store.activity(40)).toMatchObject({
      name: "Pool, edited",
      commute: true,
      areStreamsLoaded: true,
      areDetailsLoaded: true,
    });
  });

  it("scores the activity even when the athlete has no rider settings", async () => {
    store.riderSettings.clear();
    strava.put(ATHLETE, ride(41), rideStreams(200));
    strava.failNext("getStreams", new StravaError("other", "Bad Gateway"));
    await ingestion.activityCreated(ATHLETE, 41);
    expect(store.activity(41).powerBests).toBeNull();

    await ingestion.reloadActivity(ATHLETE, 41);
    expect(store.activity(41).powerBests).not.toBeNull();
  });
});

describe("rate limit", () => {
  it("waits it out during a sync instead of failing the activity", async () => {
    strava.put(ATHLETE, ride(50), rideStreams(200));
    strava.failNext("getStreams", rateLimited());

    expect(await sync()).toMatchObject({ status: "completed" });
    expect(sleeps).toEqual([60_000]);
    expect(store.activity(50)).toMatchObject({
      areStreamsLoaded: true,
      streamFetchAttempts: 0,
    });
  });

  it("waits it out on a webhook event", async () => {
    strava.put(ATHLETE, ride(51), rideStreams(200));
    strava.failNext("getActivity", rateLimited());
    await ingestion.activityCreated(ATHLETE, 51);

    expect(sleeps).toEqual([60_000]);
    expect(store.activity(51).areStreamsLoaded).toBe(true);
  });

  it("fails a reload fast, since someone is waiting on it", async () => {
    strava.put(ATHLETE, ride(52), rideStreams(200));
    await ingestion.activityCreated(ATHLETE, 52);
    strava.failNext("getActivity", rateLimited());

    await expect(ingestion.reloadActivity(ATHLETE, 52)).rejects.toMatchObject({
      kind: "rate_limited",
    });
    expect(sleeps).toEqual([]);
  });
});

// Without a usable token every call fails the same way, so it says nothing
// about the activity at hand.
describe("token failures", () => {
  const revoked = new StravaError(
    "grant_revoked",
    "Strava session expired. Please sign in again.",
  );
  const tokenEndpointDown = new StravaError(
    "token_unavailable",
    "Strava token refresh failed (502 Bad Gateway).",
  );

  it.each([
    ["a revoked grant", revoked],
    ["a token refresh that fails", tokenEndpointDown],
  ])("fails the sync job on %s without counting attempts", async (_, error) => {
    strava.put(ATHLETE, ride(60), rideStreams(200));
    strava.put(ATHLETE, ride(61), rideStreams(200));
    // Mid-sync: the page was listed, then the token goes for good.
    strava.failNext("getStreams", error, 10);
    strava.failNext("getActivity", error, 10);

    expect(await sync()).toMatchObject({
      status: "failed",
      lastError: error.message,
    });
    for (const stravaId of [60, 61]) {
      expect(store.activity(stravaId)).toMatchObject({
        streamFetchAttempts: 0,
        detailFetchAttempts: 0,
      });
    }
  });

  it("doesn't count a token failure against the activity on a webhook event", async () => {
    strava.put(ATHLETE, ride(62), rideStreams(200));
    strava.failNext("getStreams", tokenEndpointDown);

    await expect(ingestion.activityCreated(ATHLETE, 62)).rejects.toBe(
      tokenEndpointDown,
    );
    expect(store.activity(62)).toMatchObject({
      areStreamsLoaded: false,
      streamFetchAttempts: 0,
    });
  });
});
