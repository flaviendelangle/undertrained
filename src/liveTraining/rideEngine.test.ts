import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectResult } from "~/sensors/adapter";
import { createFakeSensorAdapters } from "~/sensors/fakeAdapters";
import { DEFAULT_RIDER_SETTINGS, type TrainerData } from "~/sensors/types";
import {
  type StructuredWorkout,
  computeSegmentStats,
} from "~/utils/structuredWorkout";
import { builtInWorkout } from "~/utils/structuredWorkout/builtIn";
import { makeStep, makeWorkout } from "~/utils/structuredWorkout/fixtures";

import { FakeClock } from "./fakeClock";
import { RideEngine } from "./rideEngine";

/** At the default 200 W FTP: 0–60 s at 100 W, 60–120 s at 200 W, 120–180 s at 80 W. */
const THREE_STEPS = makeWorkout([
  makeStep("a", 60, 0.5),
  makeStep("b", 60, 1),
  makeStep("c", 60, 0.4),
]);

const RAMP_TEST = builtInWorkout("ramp-test", 200, (key) => key).structure;

const PEDALING: TrainerData = { power: 200, cadence: 90 };
const STOPPED: TrainerData = { power: 0, cadence: 0 };

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(
  structure: StructuredWorkout = THREE_STEPS,
  options: { startSuspended?: boolean } = {},
) {
  const clock = new FakeClock();
  const sensors = createFakeSensorAdapters();
  const engine = new RideEngine({
    workout: { name: "Workout", structure },
    sensors,
    settings: DEFAULT_RIDER_SETTINGS,
    clock,
    ...options,
  });
  // ANT+, the default source.
  const trainer = sensors.trainer["ant+"];
  const heartRate = sensors.heartRate["ant+"];
  return {
    clock,
    sensors,
    engine,
    trainer,
    heartRate,
    ride: () => engine.store.getSnapshot(),
    points: () => engine.getDataPoints(),
    /** The targets sent to the trainer so far. */
    targets: () => trainer.setTargetPower.mock.calls.map(([watts]) => watts),
    /** Connects the trainer, ERG-capable, as the rider does from the wizard. */
    connectTrainer: async () => {
      await engine.connect("trainer");
      trainer.live.onControlAvailabilityChange(true);
    },
    /** Rides `seconds`, the trainer reporting `data` before every sample. */
    pedal: (seconds: number, data: TrainerData = PEDALING) => {
      for (let second = 0; second < seconds; second++) {
        trainer.live.onData(data);
        clock.advance(1000);
      }
    },
  };
}

type Ride = ReturnType<typeof setup>;

/** A ride started on an ERG trainer and ridden `seconds` into the workout. */
async function rideFor(seconds: number, structure?: StructuredWorkout) {
  const ride = setup(structure);
  await ride.connectTrainer();
  ride.engine.start();
  ride.pedal(seconds);
  return ride;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets the trainer's answers to the engine's commands land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the ride", () => {
  it("records the workout position from the same clock reading as each sample", async () => {
    const { engine, clock, ride, points, pedal } = await rideFor(59);
    expect(ride()).toMatchObject({ phase: "main", hasRide: true });

    engine.pause();
    clock.advance(5000);
    expect(ride()).toMatchObject({
      phase: "paused",
      pausedSeconds: 5,
      elapsedSeconds: 59,
    });
    expect(points()).toHaveLength(59);

    engine.resume();
    pedal(2);
    expect(
      points()
        .slice(-3)
        .map(({ elapsed, pauseIndex, segmentIndex }) => ({
          elapsed,
          pauseIndex,
          segmentIndex,
        })),
    ).toEqual([
      { elapsed: 59, pauseIndex: 0, segmentIndex: 0 },
      { elapsed: 60, pauseIndex: 1, segmentIndex: 1 },
      { elapsed: 61, pauseIndex: 1, segmentIndex: 1 },
    ]);

    engine.stop();
    expect(ride()).toMatchObject({ phase: "post", hasRide: true });
    expect(ride().summary).not.toBeNull();
    expect(ride().chartData).toEqual(points());
  });

  it("returns a ride stopped before its first sample to idle", async () => {
    const { engine, clock, ride, points, pedal, connectTrainer } = setup();
    await connectTrainer();
    engine.start();
    clock.advance(500);
    engine.stop();
    expect(ride()).toMatchObject({ status: "idle", hasRide: false });

    engine.start();
    pedal(1);
    expect(points()).toMatchObject([{ elapsed: 1, segmentIndex: 0 }]);
  });

  it("rides the workout again from the top after a reset", async () => {
    const { engine, ride, points, pedal } = await rideFor(10);
    engine.adjustBias(0.1);
    engine.skipSegment();
    pedal(5);
    engine.stop();

    engine.reset();
    expect(ride()).toMatchObject({
      phase: "connection",
      elapsedSeconds: 0,
      distanceKm: 0,
      chartData: [],
      summary: null,
      hasRide: false,
      workout: { segmentIndex: 0, biasPct: 1, targetWatts: 100 },
    });

    engine.start();
    pedal(1);
    expect(points()).toMatchObject([
      { elapsed: 1, pauseIndex: 0, segmentIndex: 0 },
    ]);
  });

  it.each([
    { what: "an empty workout", structure: makeWorkout([]), suspended: false },
    { what: "a suspended start", structure: THREE_STEPS, suspended: true },
  ])(
    "refuses $what, by hand and on its own",
    async ({ structure, suspended }) => {
      const { engine, clock, ride, trainer, connectTrainer } = setup(
        structure,
        { startSuspended: suspended },
      );
      await connectTrainer();
      trainer.live.onData({ power: 150 });
      engine.start();
      clock.advance(3000);
      expect(ride().status).toBe("idle");
    },
  );

  it("starts on its own after two seconds of power, not on a brief spin", async () => {
    const { clock, ride, trainer, connectTrainer } = setup();
    await connectTrainer();
    trainer.live.onData({ power: 120 });
    clock.advance(1500);
    trainer.live.onData({ power: 0 });
    clock.advance(1000);
    expect(ride().status).toBe("idle");

    // Counted from the first reading with power, however many follow.
    for (let ms = 0; ms < 2000; ms += 250) {
      trainer.live.onData({ power: 120 });
      clock.advance(250);
      expect(ride().status).toBe(ms < 1750 ? "idle" : "running");
    }
  });

  it("starts on its own once a suspended start is lifted", async () => {
    const { engine, clock, ride, trainer, connectTrainer } = setup(
      THREE_STEPS,
      { startSuspended: true },
    );
    await connectTrainer();
    trainer.live.onData({ power: 150 });
    clock.advance(3000);
    engine.setStartSuspended(false);
    clock.advance(2000);
    expect(ride().status).toBe("running");
  });

  it("follows the rider's FTP until the ride starts, and again after a reset", async () => {
    const { engine, ride, points, pedal, connectTrainer } = setup();
    await connectTrainer();
    engine.setRiderSettings({ ...DEFAULT_RIDER_SETTINGS, ftp: 300 });
    expect(ride().workout.targetWatts).toBe(150);

    engine.start();
    engine.setRiderSettings({ ...DEFAULT_RIDER_SETTINGS, ftp: 250 });
    pedal(1);
    expect(points()[0].targetPower).toBe(150);

    engine.stop();
    engine.reset();
    expect(ride().workout.targetWatts).toBe(125);
  });

  it("shows the wizard until the trainer and either a strap or the choice to skip it are in", async () => {
    const { engine, heartRate, ride, connectTrainer } = setup();
    expect(ride().phase).toBe("connection");
    await connectTrainer();
    expect(ride().phase).toBe("connection");
    await engine.connect("heartRate");
    expect(ride().phase).toBe("waiting");
    heartRate.live.onDisconnect();
    expect(ride().phase).toBe("connection");
    engine.skipHeartRate();
    expect(ride().phase).toBe("waiting");
  });
});

describe("ERG", () => {
  it("comes on with a controllable trainer and holds the workout's target", async () => {
    const { engine, clock, ride, points, targets, pedal, connectTrainer } =
      setup();
    await connectTrainer();
    expect(ride().erg.enabled).toBe(true);
    // The first step while waiting, so the trainer is already at warm-up
    // resistance when the ride starts.
    clock.advance(200);
    expect(targets()).toEqual([100]);

    engine.start();
    pedal(61);
    expect(targets()).toEqual([100, 100, 200]);
    expect(points().at(-1)?.targetPower).toBe(200);
  });

  it("lets go of a trainer that comes up with nothing to hold", async () => {
    // A trainer left in ERG by an earlier page, then a free warm-up.
    const structure = makeWorkout([
      makeStep("warm", 300, { kind: "free" }),
      makeStep("ramp", 60, 0.5),
    ]);
    const { clock, trainer, connectTrainer } = setup(structure);
    await connectTrainer();
    clock.advance(200);
    expect(trainer.releaseControl).toHaveBeenCalledOnce();
    expect(trainer.setTargetPower).not.toHaveBeenCalled();
  });

  it("holds no target through a free step, even across a pause, then the next step's", async () => {
    const structure = makeWorkout([
      makeStep("warm", 10, 0.5),
      makeStep("test", 10, { kind: "free" }),
      makeStep("cool", 10, 0.4),
    ]);
    const { engine, clock, trainer, targets, pedal } = await rideFor(
      10,
      structure,
    );
    expect(trainer.releaseControl).toHaveBeenCalledOnce();
    pedal(5);
    engine.pause();
    clock.advance(30_000);
    engine.resume();
    pedal(5);
    clock.advance(200);
    expect(targets()).toEqual([100, 80]);
    expect(trainer.releaseControl).toHaveBeenCalledOnce();
  });

  it.each([
    ["ERG is switched off", (ride: Ride) => ride.engine.setErgEnabled(false)],
    ["the ride is paused", (ride: Ride) => ride.engine.pause()],
    ["the workout is ended", (ride: Ride) => ride.engine.endWorkout()],
    ["the ride is stopped", (ride: Ride) => ride.engine.stop()],
    ["the workout runs out", (ride: Ride) => ride.pedal(60)],
  ])("lets go of the trainer once when %s", async (_, end) => {
    const ride = await rideFor(65, makeWorkout([makeStep("only", 120, 1)]));
    ride.trainer.setTargetPower.mockClear();
    end(ride);
    ride.pedal(5);
    expect(ride.trainer.releaseControl).toHaveBeenCalledOnce();
    expect(ride.trainer.setTargetPower).not.toHaveBeenCalled();
  });

  it("sends nothing once the page has let go of the trainer", async () => {
    const { engine, clock, trainer, heartRate, connectTrainer } = setup();
    await connectTrainer();
    await engine.connect("heartRate");
    engine.dispose();
    clock.advance(1000);
    expect(trainer.setTargetPower).not.toHaveBeenCalled();
    // The adapters release ERG as they disconnect.
    expect(trainer.disconnect).toHaveBeenCalledOnce();
    expect(heartRate.disconnect).toHaveBeenCalledOnce();
  });

  it.each<[string, (ride: Ride) => void | Promise<void>]>([
    ["the tab comes back", (ride) => ride.engine.reassertTarget()],
    [
      "readings come back after a dropout",
      ({ clock, trainer }: Ride) => {
        clock.advance(3000);
        trainer.live.onData(PEDALING);
      },
    ],
    [
      "the trainer reconnects",
      async ({ trainer, connectTrainer }: Ride) => {
        trainer.live.onDisconnect();
        await connectTrainer();
      },
    ],
  ])("sends the target again when %s", async (_, interrupt) => {
    const ride = await rideFor(5);
    ride.trainer.setTargetPower.mockClear();
    await interrupt(ride);
    ride.clock.advance(200);
    expect(ride.targets()).toEqual([100]);
  });

  it("does not resend after a gap shorter than a reading lasts", async () => {
    const { clock, trainer } = await rideFor(5);
    trainer.setTargetPower.mockClear();
    // Two seconds since the last reading.
    clock.advance(1000);
    trainer.live.onData(PEDALING);
    clock.advance(200);
    expect(trainer.setTargetPower).not.toHaveBeenCalled();
  });

  it("keeps the ride and its recording through a lost trainer", async () => {
    const { engine, trainer, ride, points, pedal, connectTrainer, clock } =
      await rideFor(5);
    const recording = points();
    trainer.live.onDisconnect();
    expect(ride()).toMatchObject({ phase: "main", erg: { enabled: false } });
    clock.advance(1000);
    expect(points().at(-1)?.power).toBeNull();

    await connectTrainer();
    pedal(1);
    expect(engine.getDataPoints()).toBe(recording);
    expect(ride()).toMatchObject({ phase: "main", erg: { enabled: true } });
    expect(points().at(-1)?.power).toBe(200);
  });

  it("tells the rider when the trainer refuses a target, whatever the phase", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { trainer, ride, pedal } = await rideFor(55);
    trainer.setTargetPower.mockRejectedValueOnce(new Error("refused"));
    pedal(6);
    await settle();
    expect(ride()).toMatchObject({ phase: "main", erg: { error: true } });

    // The next target is accepted.
    pedal(60);
    await settle();
    expect(ride().erg.error).toBe(false);
  });

  it("says nothing about a target that a release overtook", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { engine, trainer, ride, pedal } = await rideFor(55);
    const write = deferred<void>();
    trainer.setTargetPower.mockReturnValueOnce(write.promise);
    pedal(6);
    engine.pause();
    write.reject(new Error("Superseded by a newer FTMS command"));
    await settle();
    expect(ride().erg.error).toBe(false);
  });

  it("passes on the trainer's verdict on a target only while it holds one", async () => {
    const { engine, trainer, ride } = await rideFor(5);
    trainer.live.onTargetStatusChange("LowSpeed");
    expect(ride().erg.targetStatus).toBe("LowSpeed");
    engine.pause();
    expect(ride().erg.targetStatus).toBeNull();
  });
});

describe("the recording", () => {
  it.each([
    ["the rider ends the workout", (ride: Ride) => ride.engine.endWorkout()],
    ["the workout runs out", (ride: Ride) => ride.pedal(149)],
  ])("credits no step with what is ridden once %s", async (_, end) => {
    const ride = await rideFor(30);
    end(ride);
    const done = ride.points().length;
    ride.pedal(60);

    const after = ride.points().slice(done);
    expect(after).toHaveLength(60);
    expect(
      after.every(
        (point) => point.segmentIndex === null && point.targetPower === null,
      ),
    ).toBe(true);
    const stats = computeSegmentStats(
      ride.points(),
      ride.ride().workout.segments,
    );
    expect(stats.reduce((sum, stat) => sum + stat.seconds, 0)).toBe(done);
  });

  it("shows and records each reading for as long as it lasts", async () => {
    const { engine, clock, trainer, heartRate, ride, points } =
      await rideFor(0);
    await engine.connect("heartRate");
    trainer.live.onData({ power: 250, cadence: 90, heartRate: 140 });
    heartRate.live.onData({ heartRate: 150 });
    clock.advance(1000);
    // A strap's heart rate wins over the trainer's.
    expect(ride().live).toMatchObject({
      power: 250,
      cadence: 90,
      heartRate: 150,
    });
    expect(points().at(-1)).toMatchObject({
      power: 250,
      cadence: 90,
      heartRate: 150,
    });

    // The trainer's reading lasts 2.5 s, the strap's 5 s.
    clock.advance(1500);
    expect(ride().live).toMatchObject({
      power: null,
      cadence: null,
      heartRate: 150,
    });
    clock.advance(500);
    expect(points().at(-1)).toMatchObject({ power: null, heartRate: 150 });

    trainer.live.onData({ power: 240, heartRate: 141 });
    clock.advance(2000);
    expect(ride().live.heartRate).toBe(141);
    expect(points().at(-1)).toMatchObject({ power: 240, heartRate: 141 });

    heartRate.live.onData({ heartRate: 152 });
    heartRate.live.onDisconnect();
    expect(ride().live.heartRate).toBe(141);
  });
});

describe("the ramp test", () => {
  /** Rides through the free warm-up and into the first ramp step. */
  async function intoTheRamp() {
    const ride = await rideFor(0, RAMP_TEST);
    ride.pedal(360, { power: 120, cadence: 85 });
    return ride;
  }

  it("moves on to the full cooldown after ten seconds of measured stopped pedaling", async () => {
    const { ride, clock, trainer, pedal } = await intoTheRamp();
    pedal(10, STOPPED);
    expect(ride().workout.currentSegment?.intensity).toBe("work");
    pedal(1, STOPPED);
    expect(ride()).toMatchObject({
      status: "running",
      workout: {
        currentSegment: { intensity: "cooldown" },
        secondsRemainingInSegment: 600,
      },
    });
    clock.advance(200);
    expect(trainer.setTargetPower).toHaveBeenLastCalledWith(75);
  });

  it.each([
    [
      "a brief dip",
      ({ pedal }: Ride) => {
        pedal(9, STOPPED);
        pedal(15, { power: 20, cadence: 30 });
      },
    ],
    [
      "zero power with the cranks turning",
      ({ pedal }: Ride) => pedal(15, { power: 0, cadence: 80 }),
    ],
    [
      "a trainer gone quiet",
      ({ clock, pedal }: Ride) => {
        pedal(1, STOPPED);
        clock.advance(15_000);
      },
    ],
    [
      "a pause",
      ({ engine, pedal }: Ride) => {
        pedal(8, STOPPED);
        engine.pause();
        engine.resume();
        pedal(8, STOPPED);
      },
    ],
    [
      "a suspended tab",
      ({ clock, trainer, pedal }: Ride) => {
        pedal(5, STOPPED);
        clock.stall(14_000);
        trainer.live.onData(STOPPED);
        clock.advance(0);
        pedal(8, STOPPED);
      },
    ],
  ])("is not ended by %s", async (_, scenario) => {
    const ride = await intoTheRamp();
    scenario(ride);
    expect(ride.ride().workout.currentSegment?.intensity).toBe("work");
  });

  it("ignores skips, ±1 min and the bias, but finishes the effort on request", async () => {
    const { engine, ride, pedal } = await intoTheRamp();
    pedal(65);
    const before = ride().workout;
    engine.adjustBias(0.2);
    engine.skipSegment();
    engine.extendSegment(60);
    expect(ride().workout).toMatchObject({
      segmentIndex: before.segmentIndex,
      secondsIntoSegment: before.secondsIntoSegment,
      targetWatts: before.targetWatts,
      canFinishTest: true,
    });

    engine.finishTest();
    expect(ride().workout).toMatchObject({
      currentSegment: { intensity: "cooldown" },
      secondsRemainingInSegment: 600,
      isFinished: false,
    });
  });
});

describe("workout controls", () => {
  it("skips to the start of the next step, and finishes from the last one", async () => {
    const { engine, ride } = await rideFor(10);
    engine.skipSegment();
    expect(ride().workout).toMatchObject({
      segmentIndex: 1,
      secondsIntoSegment: 0,
    });
    engine.skipSegment();
    engine.skipSegment();
    expect(ride().workout).toMatchObject({
      isFinished: true,
      targetWatts: null,
    });
  });

  // "+1′" is labelled "Change this step by {step} seconds", so a positive
  // delta must make the step last longer.
  it.each([
    { at: 90, delta: 30, into: 0, left: 60, what: "lengthens the step" },
    {
      at: 90,
      delta: 60,
      into: 0,
      left: 60,
      what: "lengthens it by no more than was ridden of it",
    },
    { at: 10, delta: -30, into: 40, left: 20, what: "shortens the step" },
    {
      at: 10,
      delta: -600,
      into: 55,
      left: 5,
      what: "never shortens it away",
    },
  ])("$what", async ({ at, delta, into, left }) => {
    const { engine, ride } = await rideFor(at);
    const step = ride().workout.segmentIndex;
    engine.extendSegment(delta);
    expect(ride().workout).toMatchObject({
      segmentIndex: step,
      secondsIntoSegment: into,
      secondsRemainingInSegment: left,
    });
  });

  it("scales the targets with the bias, within limits", async () => {
    const { engine, ride } = await rideFor(70);
    engine.adjustBias(0.1);
    expect(ride().workout.targetWatts).toBe(220);
    engine.adjustBias(10);
    expect(ride().workout.biasPct).toBe(1.5);
  });
});

describe("sensors", () => {
  it("reports control only once the trainer is connected", async () => {
    const { engine, trainer, ride } = setup();
    const pending = deferred<ConnectResult>();
    trainer.result = pending.promise;
    const connecting = engine.connect("trainer");
    // A BLE trainer probes its control point before connect() resolves.
    trainer.live.onControlAvailabilityChange(true);
    expect(ride().trainer).toMatchObject({
      state: "connecting",
      supportsControl: false,
    });
    expect(ride().erg.enabled).toBe(false);

    pending.resolve({ status: "connected", deviceName: "KICKR" });
    await connecting;
    expect(ride().trainer).toMatchObject({
      state: "connected",
      deviceName: "KICKR",
      supportsControl: true,
    });
  });

  it.each([
    { result: { status: "cancelled" }, state: "disconnected", reason: null },
    {
      result: { status: "failed", reason: "unsupported-device" },
      state: "error",
      reason: "unsupported-device",
    },
  ] as const)(
    "settles a $result.status connect as $state, and retries cleanly",
    async ({ result, state, reason }) => {
      const { engine, heartRate, ride } = setup();
      heartRate.result = result;
      await engine.connect("heartRate");
      expect(ride().heartRate).toMatchObject({ state, errorReason: reason });

      heartRate.result = { status: "connected", deviceName: null };
      await engine.connect("heartRate");
      expect(ride().heartRate).toMatchObject({
        state: "connected",
        errorReason: null,
      });
    },
  );

  it("drops everything a trainer reported when it goes away on its own", async () => {
    const { engine, trainer, ride } = setup();
    trainer.result = { status: "connected", deviceName: "Suito" };
    await engine.connect("trainer");
    trainer.live.onControlAvailabilityChange(true);
    trainer.live.onTargetStatusChange("LowSpeed");
    trainer.live.onData({ power: 250 });

    trainer.live.onDisconnect();
    expect(ride()).toMatchObject({
      trainer: { state: "disconnected", deviceName: null },
      live: { power: null },
      erg: { enabled: false, targetStatus: null },
    });
    expect(ride().trainer.supportsControl).toBe(false);
  });

  it("ignores what a connection reports once the rider has let go of it", async () => {
    const { engine, heartRate, ride } = setup();
    await engine.connect("heartRate");
    const previous = heartRate.live;
    await engine.disconnect("heartRate");
    previous.onData({ heartRate: 150 });
    expect(ride().heartRate.state).toBe("disconnected");

    // Not even once the strap is back on a new connection.
    await engine.connect("heartRate");
    previous.onData({ heartRate: 150 });
    expect(ride().live.heartRate).toBeNull();
  });

  it("stays disconnected when the rider lets go before connect() resolves", async () => {
    const { engine, heartRate, ride } = setup();
    const pending = deferred<ConnectResult>();
    heartRate.result = pending.promise;
    const connecting = engine.connect("heartRate");
    await engine.disconnect("heartRate");
    pending.resolve({ status: "connected", deviceName: null });
    await connecting;
    expect(ride().heartRate.state).toBe("disconnected");
  });

  it("lets go of the device on the previous source when the source changes", async () => {
    const { engine, sensors, ride } = setup();
    await engine.connect("trainer");
    engine.setSource("trainer", "ble");
    expect(sensors.trainer["ant+"].disconnect).toHaveBeenCalledOnce();
    expect(sensors.trainer.ble.disconnect).not.toHaveBeenCalled();
    expect(ride().trainer).toMatchObject({
      source: "ble",
      state: "disconnected",
    });
  });
});
