import { describe, expect, it } from "vitest";

import {
  type Analysis,
  type WorkoutKind,
  activityTypesFor,
  getActivityTypesByCategory,
  getSportConfig,
  hasZoneThreshold,
  supportsAnalysis,
  workoutChoiceToValue,
  workoutChoicesForSport,
  workoutKind,
  workoutTypesOfKind,
  workoutValueToChoice,
} from "./sportConfig";

describe("analyses", () => {
  it.each<[Analysis, string[]]>([
    ["power", ["Ride", "VirtualRide"]],
    ["pace", ["Run", "VirtualRun"]],
    ["bestEfforts", ["Run", "VirtualRun"]],
    // Simulated distance and altitude don't make records.
    ["speedAndClimbing", ["Ride"]],
  ])("%s covers %j", (analysis, types) => {
    expect(activityTypesFor(analysis)).toEqual(types);
  });

  it("gives unknown Strava types no analysis", () => {
    expect(supportsAnalysis("Yoga", "power")).toBe(false);
    expect(supportsAnalysis("Yoga", "pace")).toBe(false);
  });
});

describe("getActivityTypesByCategory", () => {
  it("leaves virtual types out on request", () => {
    expect(getActivityTypesByCategory("running")).toEqual([
      "Run",
      "VirtualRun",
    ]);
    expect(
      getActivityTypesByCategory("running", { includeVirtual: false }),
    ).toEqual(["Run"]);
    expect(
      getActivityTypesByCategory("cycling", { includeVirtual: false }),
    ).toEqual(["Ride"]);
  });
});

describe("zone model", () => {
  it.each([
    ["Ride", "power"],
    ["VirtualRide", "power"],
    ["Run", "pace"],
    ["VirtualRun", "pace"],
    ["Hike", "hr"],
    ["WeightTraining", "hr"],
    // Unknown Strava types fall back to the base config.
    ["Yoga", "hr"],
    // sTSS is pace-based, but there is no swim pace-zone model.
    ["Swim", null],
  ])("%s → %s", (type, model) => {
    expect(getSportConfig(type).zoneModel).toBe(model);
  });

  it("needs the threshold each model is computed against", () => {
    const unset = { ftp: 0, runThresholdPace: 0, maxHr: 0 };
    expect(hasZoneThreshold("power", unset)).toBe(false);
    expect(hasZoneThreshold("pace", unset)).toBe(false);
    expect(hasZoneThreshold("hr", unset)).toBe(false);
    expect(hasZoneThreshold("power", { ...unset, ftp: 250 })).toBe(true);
    expect(hasZoneThreshold("pace", { ...unset, runThresholdPace: 4 })).toBe(
      true,
    );
    expect(hasZoneThreshold("hr", { ...unset, maxHr: 190 })).toBe(true);
  });
});

describe("workout types", () => {
  it("encodes each sport's choices as Strava's integers", () => {
    for (const type of ["Run", "VirtualRun"]) {
      expect(workoutChoicesForSport(type)).toEqual([
        "none",
        "race",
        "long_run",
        "workout",
      ]);
      expect(
        workoutChoicesForSport(type)!.map((c) => workoutChoiceToValue(type, c)),
      ).toEqual([0, 1, 2, 3]);
      expect([0, 1, 2, 3].map((v) => workoutValueToChoice(type, v))).toEqual([
        "none",
        "race",
        "long_run",
        "workout",
      ]);
    }
    for (const type of ["Ride", "VirtualRide"]) {
      expect(workoutChoicesForSport(type)).toEqual(["none", "race", "workout"]);
      expect(
        workoutChoicesForSport(type)!.map((c) => workoutChoiceToValue(type, c)),
      ).toEqual([10, 11, 12]);
      expect([10, 11, 12].map((v) => workoutValueToChoice(type, v))).toEqual([
        "none",
        "race",
        "workout",
      ]);
    }
  });

  it("treats a ride's long run as unspecified", () => {
    expect(workoutChoiceToValue("Ride", "long_run")).toBe(10);
  });

  it("reads unset or foreign values back as none", () => {
    expect(workoutValueToChoice("Ride", null)).toBe("none");
    // Rides have no long run: an unset value must not match the missing entry.
    expect(workoutValueToChoice("Ride", undefined)).toBe("none");
    // A ride race on a run (e.g. after the sport was changed).
    expect(workoutValueToChoice("Run", 11)).toBe("none");
  });

  it("has no workout type for other sports", () => {
    for (const type of ["Swim", "WeightTraining", "Yoga"]) {
      expect(workoutChoicesForSport(type)).toBeNull();
      expect(workoutChoiceToValue(type, "workout")).toBeUndefined();
      expect(workoutValueToChoice(type, 30)).toBe("none");
    }
  });

  it.each<[WorkoutKind, number[]]>([
    ["none", [0, 10]],
    ["race", [1, 11]],
    ["long_run", [2]],
    ["workout", [3, 12]],
    ["weight_training", [30]],
  ])("%s is stored as %j, whatever the sport", (kind, values) => {
    expect(workoutTypesOfKind(kind)).toEqual(values);
    for (const value of values) {
      expect(workoutKind(value)).toBe(kind);
    }
  });

  it("gives unset and unknown values no kind", () => {
    expect(workoutKind(null)).toBeNull();
    expect(workoutKind(undefined)).toBeNull();
    expect(workoutKind(99)).toBeNull();
  });
});
