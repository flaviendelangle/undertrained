import { afterEach, expect, it, vi } from "vitest";

import type { TrainerEvents } from "../adapter";
import {
  createFakeCharacteristic,
  createFakeDevice,
  createMeasurementCharacteristic,
  stubBluetooth,
} from "./fakeGatt";
import {
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  FTMS_CONTROL_POINT,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  INDOOR_BIKE_DATA,
} from "./services";
import { BleTrainerAdapter } from "./trainer";

const OP_RESET = 0x01;
const OP_SET_TARGET_POWER = 0x05;
/** Bit 3 of Target Setting Features. */
const POWER_TARGET_SETTING = 1 << 3;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function trainerEvents() {
  return {
    onData: vi.fn(),
    onDisconnect: vi.fn(),
    onControlAvailabilityChange: vi.fn(),
    onTargetStatusChange: vi.fn(),
  } satisfies TrainerEvents;
}

/**
 * An FTMS trainer. `targetSettingFeatures` null leaves out the Fitness
 * Machine Feature characteristic, as some trainers do.
 */
function ftmsTrainer({
  targetSettingFeatures = POWER_TARGET_SETTING,
  controlPoint = true,
}: { targetSettingFeatures?: number | null; controlPoint?: boolean } = {}) {
  const bikeData = createMeasurementCharacteristic(INDOOR_BIKE_DATA);
  const control = createFakeCharacteristic();
  const characteristics: Record<number, BluetoothRemoteGATTCharacteristic> = {
    [INDOOR_BIKE_DATA]: bikeData.characteristic,
  };
  if (controlPoint)
    characteristics[FTMS_CONTROL_POINT] = control.characteristic;
  if (targetSettingFeatures != null) {
    // Fitness Machine Features, then Target Setting Features, both UINT32.
    characteristics[FITNESS_MACHINE_FEATURE] = createMeasurementCharacteristic(
      FITNESS_MACHINE_FEATURE,
      [0, 0, 0, 0, targetSettingFeatures, 0, 0, 0],
    ).characteristic;
  }
  const { device, dropConnection } = createFakeDevice("KICKR CORE", {
    [FITNESS_MACHINE_SERVICE]: characteristics,
  });
  return { device, dropConnection, bikeData, control };
}

it("streams an FTMS trainer's data and drives ERG through its control point", async () => {
  const trainer = ftmsTrainer();
  stubBluetooth(trainer.device);
  const events = trainerEvents();
  const adapter = new BleTrainerAdapter();

  await expect(adapter.connect(events)).resolves.toEqual({
    status: "connected",
    deviceName: "KICKR CORE",
  });
  // Indoor Bike Data: no instantaneous speed, instantaneous power 210 W.
  trainer.bikeData.notify([0x41, 0x00, 0xd2, 0x00]);
  await adapter.setTargetPower(200);
  await adapter.releaseControl();

  expect(events.onControlAvailabilityChange).toHaveBeenCalledExactlyOnceWith(
    true,
  );
  expect(events.onData).toHaveBeenCalledWith({ power: 210 });
  expect(trainer.control.opCodes().slice(-2)).toEqual([
    OP_SET_TARGET_POWER,
    OP_RESET,
  ]);
});

it.each([
  {
    trainer: "advertises no power target",
    options: { targetSettingFeatures: 0 },
    available: false,
  },
  {
    trainer: "has no control point",
    options: { controlPoint: false },
    available: false,
  },
  {
    trainer: "does not say what it supports",
    options: { targetSettingFeatures: null },
    available: true,
  },
])(
  "offers ERG ($available) on an FTMS trainer that $trainer",
  async ({ options, available }) => {
    stubBluetooth(ftmsTrainer(options).device);
    const events = trainerEvents();

    await new BleTrainerAdapter().connect(events);

    expect(events.onControlAvailabilityChange).toHaveBeenCalledExactlyOnceWith(
      available,
    );
  },
);

it("reads a plain power meter over the Cycling Power Service, without ERG", async () => {
  const power = createMeasurementCharacteristic(CYCLING_POWER_MEASUREMENT);
  const { device } = createFakeDevice("Assioma", {
    [CYCLING_POWER_SERVICE]: {
      [CYCLING_POWER_MEASUREMENT]: power.characteristic,
    },
  });
  stubBluetooth(device);
  const events = trainerEvents();
  const adapter = new BleTrainerAdapter();

  await adapter.connect(events);
  // Cycling Power Measurement: no flags, instantaneous power 180 W.
  power.notify([0x00, 0x00, 0xb4, 0x00]);

  expect(events.onData).toHaveBeenCalledWith(
    expect.objectContaining({ power: 180 }),
  );
  expect(events.onControlAvailabilityChange).not.toHaveBeenCalled();
  await expect(adapter.setTargetPower(200)).rejects.toThrow();
});

it.each([
  { picked: "nothing", result: { status: "cancelled" } },
  {
    picked: "a heart rate strap",
    result: { status: "failed", reason: "unsupported-device" },
  },
])("settles a chooser where the rider picked $picked", async ({ result }) => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const strap = createFakeDevice("HRM-Pro", {
    [HEART_RATE_SERVICE]: {
      [HEART_RATE_MEASUREMENT]: createMeasurementCharacteristic(
        HEART_RATE_MEASUREMENT,
      ).characteristic,
    },
  });
  stubBluetooth(result.status === "cancelled" ? "dismissed" : strap.device);

  await expect(
    new BleTrainerAdapter().connect(trainerEvents()),
  ).resolves.toEqual(result);
});

it("lists every nearby device when asked, for trainers that do not advertise", async () => {
  const requestDevice = stubBluetooth(ftmsTrainer().device);

  await new BleTrainerAdapter().connect(trainerEvents(), {
    acceptAllDevices: true,
  });

  const [options] = requestDevice.mock.calls[0];
  expect(options).toMatchObject({ acceptAllDevices: true });
  expect(options).not.toHaveProperty("filters");
});

it("reports a trainer that drops on its own", async () => {
  const trainer = ftmsTrainer();
  stubBluetooth(trainer.device);
  const events = trainerEvents();
  const adapter = new BleTrainerAdapter();
  await adapter.connect(events);

  trainer.dropConnection();

  expect(events.onDisconnect).toHaveBeenCalledOnce();
  await expect(adapter.setTargetPower(200)).rejects.toThrow();
});

it("resets the trainer when the rider lets go, without reporting a drop", async () => {
  const trainer = ftmsTrainer();
  stubBluetooth(trainer.device);
  const events = trainerEvents();
  const adapter = new BleTrainerAdapter();
  await adapter.connect(events);

  await adapter.disconnect();

  expect(trainer.control.opCodes()).toEqual([OP_RESET]);
  expect(events.onDisconnect).not.toHaveBeenCalled();
});
