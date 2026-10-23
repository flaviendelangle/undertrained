import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SensorEvents, TrainerEvents } from "../adapter";
import type { HeartRateData } from "../types";

vi.mock("ant-plus-next", () => import("./fakeAntPlus"));

// The shared stick is module state, so every test loads the adapters afresh.
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function load() {
  // Through the mock, so these are the very classes the adapters construct.
  const antPlus =
    (await import("ant-plus-next")) as unknown as typeof import("./fakeAntPlus");
  antPlus.sticks.length = 0;
  antPlus.sensors.length = 0;
  const { AntHeartRateAdapter } = await import("./heartRate");
  const { AntTrainerAdapter } = await import("./trainer");
  return { antPlus, AntHeartRateAdapter, AntTrainerAdapter };
}

function heartRateEvents() {
  return {
    onData: vi.fn(),
    onDisconnect: vi.fn(),
  } satisfies SensorEvents<HeartRateData>;
}

function trainerEvents() {
  return {
    onData: vi.fn(),
    onDisconnect: vi.fn(),
    onControlAvailabilityChange: vi.fn(),
    onTargetStatusChange: vi.fn(),
  } satisfies TrainerEvents;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Lets the library's deferred "detached" events and pending promises run.
 * One millisecond, because a zero-delay timer set while fake timers are
 * ticking is pushed back by that much.
 */
async function flush() {
  await vi.advanceTimersByTimeAsync(1);
}

const CONNECTED = { status: "connected", deviceName: null };

describe("ANT+ disconnects", () => {
  it.each([
    { sensorsAttached: true, how: "fails its read loop" },
    { sensorsAttached: false, how: "shuts down" },
  ])(
    "reports every sensor gone when the stick $how",
    async ({ sensorsAttached }) => {
      const { antPlus, AntHeartRateAdapter, AntTrainerAdapter } = await load();
      const hrEvents = heartRateEvents();
      const trEvents = trainerEvents();
      const hr = new AntHeartRateAdapter();
      const trainer = new AntTrainerAdapter();
      await hr.connect(hrEvents);
      await trainer.connect(trEvents);

      antPlus.sticks[0].unplug({ sensorsAttached });
      await flush();

      expect(hrEvents.onDisconnect).toHaveBeenCalledOnce();
      expect(trEvents.onDisconnect).toHaveBeenCalledOnce();
      // Reconnecting builds a new stick rather than reusing the dead one.
      await expect(trainer.connect(trainerEvents())).resolves.toEqual(
        CONNECTED,
      );
      expect(antPlus.sticks).toHaveLength(2);
    },
  );

  it("reports the trainer gone when its channel drops, keeping the stick for the strap", async () => {
    const { antPlus, AntHeartRateAdapter, AntTrainerAdapter } = await load();
    const hrEvents = heartRateEvents();
    const trEvents = trainerEvents();
    const hr = new AntHeartRateAdapter();
    const trainer = new AntTrainerAdapter();
    await hr.connect(hrEvents);
    await trainer.connect(trEvents);
    const [stick] = antPlus.sticks;
    const feSensor = antPlus.sensors.find(
      (sensor) => sensor instanceof antPlus.FitnessEquipmentSensor,
    )!;

    feSensor.drop();
    await flush();

    expect(trEvents.onDisconnect).toHaveBeenCalledOnce();
    expect(hrEvents.onDisconnect).not.toHaveBeenCalled();
    expect(stick.closed).toBe(false);
    // The trainer gave its reference back, so the strap was the last holder.
    await hr.disconnect();
    expect(stick.closed).toBe(true);
  });

  it.each(["AntHeartRateAdapter", "AntTrainerAdapter"] as const)(
    "%s does not report a disconnect the rider asked for, even on a quick reconnect",
    async (name) => {
      const loaded = await load();
      const adapter = new loaded[name]();
      const first = trainerEvents();
      const second = trainerEvents();
      await adapter.connect(first);

      await adapter.disconnect();
      expect(loaded.antPlus.sticks[0].closed).toBe(true);
      await adapter.connect(second);
      // The library confirms the first detach only now.
      await flush();

      expect(first.onDisconnect).not.toHaveBeenCalled();
      expect(second.onDisconnect).not.toHaveBeenCalled();
    },
  );
});

describe("ANT+ trainer", () => {
  it("unlocks ERG once FE-C data arrives, and stays on FE-C", async () => {
    const { antPlus, AntTrainerAdapter } = await load();
    const events = trainerEvents();
    const trainer = new AntTrainerAdapter();
    await trainer.connect(events);
    const feSensor = antPlus.sensors[0] as InstanceType<
      typeof antPlus.FitnessEquipmentSensor
    >;

    feSensor.emit("fitnessData", {
      InstantaneousPower: 210,
      Cadence: 88,
      // The library's reading of FE-C's 0xFFFF "invalid speed" sentinel.
      RealSpeed: 65.535,
      TargetStatus: "LowSpeed",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await trainer.setTargetPower(250);

    expect(events.onControlAvailabilityChange).toHaveBeenCalledExactlyOnceWith(
      true,
    );
    expect(events.onTargetStatusChange).toHaveBeenCalledWith("LowSpeed");
    expect(events.onData).toHaveBeenCalledWith({
      power: 210,
      cadence: 88,
      speed: undefined,
      heartRate: undefined,
      distance: undefined,
    });
    expect(feSensor.setTargetPower).toHaveBeenCalledWith(250);
    expect(antPlus.sensors).toHaveLength(1);
  });

  it("falls back to the power meter profile when no FE-C data arrives", async () => {
    const { antPlus, AntTrainerAdapter } = await load();
    const events = trainerEvents();
    const trainer = new AntTrainerAdapter();
    await trainer.connect(events);

    await vi.advanceTimersByTimeAsync(5_000);
    const [feSensor, powerSensor] = antPlus.sensors;
    expect(powerSensor).toBeInstanceOf(antPlus.BicyclePowerSensor);
    expect(feSensor.channel).toBeUndefined();
    expect(powerSensor.channel).toBe(1);

    powerSensor.emit("powerData", { Power: 180, Cadence: 90 });
    await flush();

    expect(events.onControlAvailabilityChange).toHaveBeenLastCalledWith(false);
    expect(events.onData).toHaveBeenCalledWith({ power: 180, cadence: 90 });
    // Detaching the FE-C sensor was the adapter's own doing.
    expect(events.onDisconnect).not.toHaveBeenCalled();
    await expect(trainer.setTargetPower(200)).rejects.toThrow();

    powerSensor.drop();
    expect(events.onDisconnect).toHaveBeenCalledOnce();
  });

  it("leaves ERG on a flat road at the rider's rolling resistance", async () => {
    const { antPlus, AntTrainerAdapter } = await load();
    const trainer = new AntTrainerAdapter({ rollingResistance: () => 0.005 });
    await trainer.connect(trainerEvents());
    const feSensor = antPlus.sensors[0] as InstanceType<
      typeof antPlus.FitnessEquipmentSensor
    >;
    feSensor.emit("fitnessData", { InstantaneousPower: 200 });

    await trainer.releaseControl();
    expect(feSensor.setTrackResistance).toHaveBeenCalledWith(0, 0.005);

    // Letting go releases too: FE-C target power would otherwise stick.
    feSensor.setTrackResistance.mockClear();
    await trainer.disconnect();
    expect(feSensor.setTrackResistance).toHaveBeenCalledWith(0, 0.005);
  });
});

describe("ANT+ stick sharing", () => {
  it("opens one stick for both sensors and closes it when the last lets go", async () => {
    const { antPlus, AntHeartRateAdapter, AntTrainerAdapter } = await load();
    const hr = new AntHeartRateAdapter();
    const trainer = new AntTrainerAdapter();

    await Promise.all([
      hr.connect(heartRateEvents()),
      trainer.connect(trainerEvents()),
    ]);
    expect(antPlus.sticks).toHaveLength(1);

    await hr.disconnect();
    expect(antPlus.sticks[0].closed).toBe(false);
    await trainer.disconnect();
    expect(antPlus.sticks[0].closed).toBe(true);
  });

  it("does not close the stick under a sensor that is still attaching", async () => {
    const { antPlus, AntHeartRateAdapter, AntTrainerAdapter } = await load();
    const trainerAttached = deferred();
    vi.spyOn(
      antPlus.FitnessEquipmentSensor.prototype,
      "attach",
    ).mockImplementationOnce(() => trainerAttached.promise);
    vi.spyOn(antPlus.HeartRateSensor.prototype, "attach").mockRejectedValueOnce(
      new Error("No free channel"),
    );
    const hr = new AntHeartRateAdapter();
    const trainer = new AntTrainerAdapter();

    const trainerConnecting = trainer.connect(trainerEvents());
    await expect(hr.connect(heartRateEvents())).resolves.toEqual({
      status: "failed",
      reason: "failed",
    });

    expect(antPlus.sticks[0].closed).toBe(false);
    trainerAttached.resolve();
    await expect(trainerConnecting).resolves.toEqual(CONNECTED);
  });

  it("gives the stick back when disconnect() overtakes an attach", async () => {
    const { antPlus, AntTrainerAdapter } = await load();
    const attached = deferred();
    vi.spyOn(
      antPlus.FitnessEquipmentSensor.prototype,
      "attach",
    ).mockImplementationOnce(() => attached.promise);
    const trainer = new AntTrainerAdapter();

    const connecting = trainer.connect(trainerEvents());
    await flush();
    await trainer.disconnect();
    attached.resolve();

    await expect(connecting).resolves.toEqual({ status: "cancelled" });
    expect(antPlus.sticks[0].closed).toBe(true);
  });
});
