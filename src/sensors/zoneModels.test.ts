import { describe, expect, it } from "vitest";

import type { ZoneModel } from "~/utils/sportConfig";

import { ZONE_MODELS } from "./zoneModels";

// FTP 100 W, threshold pace 4 m/s, and a 150 bpm heart-rate reserve keep every
// boundary exact in floating point.
const settings = { ftp: 100, runThresholdPace: 4, maxHr: 200, restingHr: 50 };

describe("ZONE_MODELS classify", () => {
  it.each<[ZoneModel, number, number, string]>([
    // Power: each zone's upper bound (% of FTP) belongs to the next zone.
    ["power", 54.9, 0, "Recovery"],
    ["power", 55, 1, "Endurance"],
    ["power", 104.9, 3, "Threshold"],
    ["power", 105, 4, "VO2max"],
    ["power", 150, 6, "Neuromuscular"],
    // Pace: each zone's upper bound (speed / threshold speed) is inclusive.
    ["pace", 0.775 * 4, 0, "Zone 1"],
    ["pace", 3.11, 1, "Zone 2"],
    ["pace", 4, 3, "Zone 4"],
    ["pace", 4.01, 4, "Zone 5a"],
    ["pace", 1.115 * 4, 5, "Zone 5b"],
    ["pace", 4.47, 6, "Zone 5c"],
    // Heart rate: % of reserve above resting; upper bounds are exclusive, and
    // values outside the reserve clamp to the first and last zones.
    ["hr", 40, 0, "Recovery"],
    ["hr", 139, 0, "Recovery"],
    ["hr", 140, 1, "Aerobic"],
    ["hr", 184, 3, "Threshold"],
    ["hr", 185, 4, "VO2max"],
    ["hr", 210, 4, "VO2max"],
  ])("%s %d → zone %d (%s)", (model, value, index, name) => {
    const match = ZONE_MODELS[model].classify(value, settings);
    expect(match.index).toBe(index);
    expect(match.zone.name).toBe(name);
  });
});
