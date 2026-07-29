import { describe, expect, it } from "vitest";

import {
  createCyclingPowerParser,
  parseHeartRateMeasurement,
  parseIndoorBikeData,
} from "./parsers";

/** Builds a DataView from a little-endian byte list. */
function view(...bytes: number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

function u16(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff];
}

describe("parseHeartRateMeasurement", () => {
  it("reads an 8-bit heart rate", () => {
    expect(parseHeartRateMeasurement(view(0x00, 142))?.heartRate).toBe(142);
  });

  it("reads a 16-bit heart rate when the format bit is set", () => {
    const parsed = parseHeartRateMeasurement(view(0x01, ...u16(300)));
    expect(parsed?.heartRate).toBe(300);
  });

  // Per the Heart Rate Service spec: bit 1 is Sensor Contact Status (contact
  // detected), bit 2 is Sensor Contact Support. Transposing them reports
  // contact for sensors that don't implement the feature and hides it for
  // those that do.
  it("reports contact detected when supported (bit 2) and detected (bit 1)", () => {
    expect(parseHeartRateMeasurement(view(0b0110, 120))?.sensorContact).toBe(
      true,
    );
  });

  it("reports poor contact when supported (bit 2) but not detected (bit 1)", () => {
    expect(parseHeartRateMeasurement(view(0b0100, 120))?.sensorContact).toBe(
      false,
    );
  });

  it("reports nothing when the sensor does not support contact detection", () => {
    // bit 2 clear — bit 1 is meaningless whatever its value
    expect(
      parseHeartRateMeasurement(view(0b0000, 120))?.sensorContact,
    ).toBeUndefined();
    expect(
      parseHeartRateMeasurement(view(0b0010, 120))?.sensorContact,
    ).toBeUndefined();
  });

  it("skips energy expended before reading RR intervals", () => {
    // flags: energy expended (bit3) + RR present (bit4)
    const parsed = parseHeartRateMeasurement(
      view(0b11000, 60, ...u16(500), ...u16(1024), ...u16(512)),
    );
    expect(parsed?.energyExpended).toBe(500);
    expect(parsed?.rrIntervals).toEqual([1000, 500]);
  });

  it("returns null for a payload too short to hold a reading", () => {
    expect(parseHeartRateMeasurement(view(0x00))).toBeNull();
  });

  it("does not throw when the RR field is truncated mid-value", () => {
    const parsed = parseHeartRateMeasurement(view(0b10000, 60, 0x00));
    expect(parsed?.heartRate).toBe(60);
    expect(parsed?.rrIntervals).toBeUndefined();
  });
});

describe("parseIndoorBikeData", () => {
  it("reads instantaneous speed when the More Data bit is clear", () => {
    // flags 0x0000 -> speed present, 0.01 km/h units
    const parsed = parseIndoorBikeData(view(0x00, 0x00, ...u16(3600)));
    // 3600 * 0.01 km/h = 36 km/h = 10 m/s
    expect(parsed?.speed).toBeCloseTo(10, 6);
  });

  it("omits speed when the More Data bit is set", () => {
    // flags 0x0041 -> more data (no speed) + instantaneous power
    const parsed = parseIndoorBikeData(view(0x41, 0x00, ...u16(250)));
    expect(parsed?.speed).toBeUndefined();
    expect(parsed?.power).toBe(250);
  });

  it("reads speed, cadence and power together at the right offsets", () => {
    // flags: cadence (0x04) + power (0x40) -> 0x0044, speed present
    const parsed = parseIndoorBikeData(
      view(0x44, 0x00, ...u16(3600), ...u16(180), ...u16(250)),
    );
    expect(parsed?.speed).toBeCloseTo(10, 6);
    expect(parsed?.cadence).toBe(90); // 180 * 0.5 rpm
    expect(parsed?.power).toBe(250);
  });

  it("consumes the 3-byte total distance field without shifting later fields", () => {
    // flags: distance (0x10) + power (0x40) -> 0x0050, speed present
    const parsed = parseIndoorBikeData(
      view(0x50, 0x00, ...u16(3600), 0x40, 0x0d, 0x03, ...u16(250)),
    );
    // uint24 LE: 0x030d40 = 200000 m
    expect(parsed?.distance).toBe(200000);
    expect(parsed?.power).toBe(250);
  });

  it("reads negative power as a signed value", () => {
    const parsed = parseIndoorBikeData(view(0x41, 0x00, ...u16(0xfff6)));
    expect(parsed?.power).toBe(-10);
  });

  it("reads heart rate after skipping expended energy", () => {
    // flags: energy (0x100) + heart rate (0x200) -> 0x0300, speed present
    const parsed = parseIndoorBikeData(
      view(0x00, 0x03, ...u16(3600), 1, 2, 3, 4, 5, 148),
    );
    expect(parsed?.heartRate).toBe(148);
  });

  it("returns the fields it managed to read from a truncated packet", () => {
    // Claims cadence and power but only carries speed and cadence.
    const parsed = parseIndoorBikeData(
      view(0x44, 0x00, ...u16(3600), ...u16(180)),
    );
    expect(parsed?.cadence).toBe(90);
    expect(parsed?.power).toBeUndefined();
  });

  it("returns null below the flags field", () => {
    expect(parseIndoorBikeData(view(0x00))).toBeNull();
  });
});

describe("createCyclingPowerParser", () => {
  it("always reads instantaneous power", () => {
    const parse = createCyclingPowerParser();
    expect(parse(view(0x00, 0x00, ...u16(220)))?.power).toBe(220);
  });

  it("needs two crank samples before it reports cadence", () => {
    const parse = createCyclingPowerParser();
    const flags = 0x20; // crank revolution data present
    const first = parse(
      view(flags, 0x00, ...u16(200), ...u16(10), ...u16(1024)),
    );
    expect(first?.cadence).toBeUndefined();

    // +1 revolution in exactly 1 second (1024 units of 1/1024 s) -> 60 rpm
    const second = parse(
      view(flags, 0x00, ...u16(200), ...u16(11), ...u16(2048)),
    );
    expect(second?.cadence).toBeCloseTo(60, 6);
  });

  it("handles crank counter and event-time rollover at 65535", () => {
    const parse = createCyclingPowerParser();
    const flags = 0x20;
    parse(view(flags, 0x00, ...u16(200), ...u16(65535), ...u16(65024)));
    // revolutions wrap to 0 (+1), event time wraps to 512 (+1024 = 1 s)
    const rolled = parse(
      view(flags, 0x00, ...u16(200), ...u16(0), ...u16(512)),
    );
    expect(rolled?.cadence).toBeCloseTo(60, 6);
  });

  it("omits cadence when the crank event time did not advance", () => {
    const parse = createCyclingPowerParser();
    const flags = 0x20;
    parse(view(flags, 0x00, ...u16(200), ...u16(10), ...u16(1024)));
    const same = parse(
      view(flags, 0x00, ...u16(200), ...u16(11), ...u16(1024)),
    );
    expect(same?.cadence).toBeUndefined();
  });

  it("skips the optional fields ahead of the crank data", () => {
    const parse = createCyclingPowerParser();
    // balance (0x01) + torque (0x04) + wheel data (0x10) + crank (0x20)
    const flags = 0x35;
    const payload = (revs: number, time: number) =>
      view(
        flags,
        0x00,
        ...u16(200),
        50, // pedal power balance
        ...u16(1234), // accumulated torque
        0,
        0,
        0,
        0, // cumulative wheel revolutions
        ...u16(0), // last wheel event time
        ...u16(revs),
        ...u16(time),
      );
    parse(payload(10, 1024));
    expect(parse(payload(11, 2048))?.cadence).toBeCloseTo(60, 6);
  });

  it("keeps crank state per parser instance", () => {
    const flags = 0x20;
    const first = createCyclingPowerParser();
    first(view(flags, 0x00, ...u16(200), ...u16(10), ...u16(1024)));

    // A second power meter must not derive cadence from the first one's counter.
    const second = createCyclingPowerParser();
    const fresh = second(
      view(flags, 0x00, ...u16(200), ...u16(11), ...u16(2048)),
    );
    expect(fresh?.cadence).toBeUndefined();
  });

  it("returns null below the minimum power payload", () => {
    const parse = createCyclingPowerParser();
    expect(parse(view(0x00, 0x00, 0x10))).toBeNull();
  });

  it("does not throw when the crank field is truncated", () => {
    const parse = createCyclingPowerParser();
    const parsed = parse(view(0x20, 0x00, ...u16(200), 0x0a));
    expect(parsed?.power).toBe(200);
    expect(parsed?.cadence).toBeUndefined();
  });
});
