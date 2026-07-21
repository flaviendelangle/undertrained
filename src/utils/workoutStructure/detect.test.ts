import { describe, expect, it } from "vitest";

import { detectWorkoutStructure } from "./detect";
import { type LapSpec, makeLaps, paceToSpeed, repeat } from "./fixtures";

const WARMUP_RIDE: LapSpec = { duration: 600, watts: 150 };
const COOLDOWN_RIDE: LapSpec = { duration: 300, watts: 120 };

function detectRide(specs: LapSpec[], ftp?: number) {
  return detectWorkoutStructure({
    laps: makeLaps(specs),
    activityType: "Ride",
    riderSettings: ftp != null ? { ftp, runThresholdPace: 0 } : null,
  });
}

function detectRun(specs: LapSpec[], runThresholdPace?: number) {
  return detectWorkoutStructure({
    laps: makeLaps(specs),
    activityType: "Run",
    riderSettings:
      runThresholdPace != null ? { ftp: 0, runThresholdPace } : null,
  });
}

describe("detectWorkoutStructure — cycling", () => {
  const classic = [
    WARMUP_RIDE,
    ...repeat(10, { duration: 60, watts: 280 }, { duration: 30, watts: 100 }),
    COOLDOWN_RIDE,
  ];

  it("detects a clean 10×(60s/30s) session with high confidence", () => {
    const result = detectRide(classic, 250);
    expect(result).not.toBeNull();
    expect(result?.metric).toBe("power");
    expect(result?.blocks).toHaveLength(1);
    const block = result!.blocks[0];
    expect(block.reps).toBe(10);
    expect(block.sets).toBeUndefined();
    expect(block.workDuration).toBe(60);
    expect(block.work.value).toBe(280);
    expect(block.work.zoneName).toBe("VO2max");
    expect(block.recoveryDuration).toBe(30);
    expect(block.recovery?.value).toBe(100);
    expect(block.recovery?.zoneName).toBe("Recovery");
    expect(block.recovery?.zoneIndex).toBe(0);
    expect(result?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result?.confident).toBe(true);
  });

  it("references only the structure's laps, not warmup/cooldown", () => {
    const block = detectRide(classic)!.blocks[0];
    // Warmup is lap 0, the last recovery is lap 20, cooldown is lap 21.
    expect(block.lapIndices).toHaveLength(19);
    expect(Math.min(...block.lapIndices)).toBe(1);
    expect(Math.max(...block.lapIndices)).toBe(19);
  });

  it("leaves zone labels null without rider settings", () => {
    const block = detectRide(classic)!.blocks[0];
    expect(block.work.zoneName).toBeNull();
    expect(block.work.zoneIndex).toBeNull();
  });

  it("rounds noisy laps to the planned 60s/280W/30s", () => {
    const durations = [57, 62, 58, 61, 60, 59, 63, 60, 58, 61];
    const watts = [281, 279, 285, 273, 281, 288, 276, 279, 270, 283];
    const recoveries = [28, 32, 30, 27, 34, 29, 31, 33, 30];
    const specs: LapSpec[] = [WARMUP_RIDE];
    durations.forEach((duration, i) => {
      specs.push({ duration, watts: watts[i] });
      if (i < recoveries.length)
        specs.push({ duration: recoveries[i], watts: 100 });
    });
    specs.push(COOLDOWN_RIDE);

    const result = detectRide(specs);
    const block = result!.blocks[0];
    expect(block.reps).toBe(10);
    expect(block.workDuration).toBe(60);
    expect(block.work.value).toBe(280);
    expect(block.recoveryDuration).toBe(30);
    expect(result?.confident).toBe(true);
  });

  it("keeps genuinely different blocks apart (5×30\"@330W then 4×4'@250W)", () => {
    const specs = [
      { duration: 600, watts: 140 },
      ...repeat(5, { duration: 30, watts: 330 }, { duration: 30, watts: 100 }),
      ...repeat(
        4,
        { duration: 240, watts: 250 },
        { duration: 120, watts: 100 },
      ),
      COOLDOWN_RIDE,
    ];
    const result = detectRide(specs, 250);
    expect(result?.blocks).toHaveLength(2);
    const [surges, vo2] = result!.blocks;
    expect(surges.reps).toBe(5);
    expect(surges.workDuration).toBe(30);
    expect(surges.work.value).toBe(330);
    expect(surges.work.zoneName).toBe("Anaerobic");
    expect(surges.recoveryDuration).toBe(30);
    expect(vo2.reps).toBe(4);
    expect(vo2.workDuration).toBe(240);
    expect(vo2.work.value).toBe(250);
    expect(vo2.work.zoneName).toBe("Threshold");
    expect(vo2.recoveryDuration).toBe(120);
  });

  it("absorbs one botched rep as an outlier with a confidence penalty", () => {
    const clean = detectRide(classic)!;
    const specs = classic.map((spec) => ({ ...spec }));
    specs[11].duration = 78; // 6th work lap (warmup + 5×(work+recovery))
    const noisy = detectRide(specs)!;
    expect(noisy.blocks[0].reps).toBe(10);
    expect(noisy.blocks[0].workDuration).toBe(60);
    expect(noisy.confidence).toBeLessThan(clean.confidence);
  });

  it("handles a missing final recovery lap", () => {
    const specs = [
      WARMUP_RIDE,
      ...repeat(9, { duration: 60, watts: 280 }, { duration: 30, watts: 100 }),
      { duration: 60, watts: 280 },
    ];
    const block = detectRide(specs)!.blocks[0];
    expect(block.reps).toBe(10);
    expect(block.recoveryDuration).toBe(30);
  });

  it("reports back-to-back work laps with a null recovery", () => {
    const specs = [
      WARMUP_RIDE,
      ...repeat(4, { duration: 300, watts: 290 }, null),
      COOLDOWN_RIDE,
    ];
    const block = detectRide(specs)!.blocks[0];
    expect(block.reps).toBe(4);
    expect(block.recoveryDuration).toBeNull();
    expect(block.recovery).toBeNull();
  });

  it("detects 2×20' via the long-rep rule", () => {
    const specs = [
      { duration: 900, watts: 150 },
      { duration: 1200, watts: 250 },
      { duration: 600, watts: 120 },
      { duration: 1200, watts: 252 },
      { duration: 600, watts: 110 },
    ];
    const block = detectRide(specs)!.blocks[0];
    expect(block.reps).toBe(2);
    expect(block.workDuration).toBe(1200);
    expect(block.work.value).toBe(251);
    expect(block.recoveryDuration).toBe(600);
  });

  it("rejects two stray 30s surges", () => {
    const specs = [
      WARMUP_RIDE,
      { duration: 30, watts: 350 },
      { duration: 300, watts: 100 },
      { duration: 30, watts: 340 },
      { duration: 600, watts: 130 },
    ];
    expect(detectRide(specs)).toBeNull();
  });

  it("rejects a pyramid (all steps differ)", () => {
    const specs: LapSpec[] = [{ duration: 600, watts: 140 }];
    for (const duration of [30, 60, 120, 180, 120, 60, 30]) {
      specs.push({ duration, watts: 320 });
      specs.push({ duration: 60, watts: 100 });
    }
    specs.push({ duration: 300, watts: 110 });
    expect(detectRide(specs)).toBeNull();
  });

  it("rejects km auto-laps", () => {
    const specs = Array.from({ length: 12 }, (_, i) => ({
      duration: 240,
      watts: 180 + (i % 4) * 10,
      distance: i === 11 ? 400 : 1000,
    }));
    expect(detectRide(specs)).toBeNull();
  });

  it("rejects a steady ride with no intensity gap", () => {
    const specs = [200, 203, 206, 210, 212, 215].map((watts) => ({
      duration: 600,
      watts,
      distance: 4000,
    }));
    expect(detectRide(specs)).toBeNull();
  });

  it("returns null when power is unavailable", () => {
    const specs = repeat(
      10,
      { duration: 60, speed: 9 },
      { duration: 30, speed: 5 },
    );
    expect(detectRide(specs)).toBeNull();
  });

  it("still detects with a single power-dropout lap", () => {
    const specs = [
      WARMUP_RIDE,
      ...repeat(10, { duration: 60, watts: 280 }, { duration: 30, watts: 100 }),
    ];
    delete specs[6].watts; // one recovery lap lost power
    const result = detectRide(specs);
    expect(result?.blocks[0].reps).toBe(10);
  });

  it("works for VirtualRide", () => {
    const result = detectWorkoutStructure({
      laps: makeLaps(classic),
      activityType: "VirtualRide",
    });
    expect(result?.metric).toBe("power");
    expect(result?.blocks[0].reps).toBe(10);
  });
});

describe("detectWorkoutStructure — running", () => {
  const work: LapSpec = { duration: 180, speed: paceToSpeed(270) }; // 4:30/km
  const recovery: LapSpec = { duration: 60, speed: paceToSpeed(390) }; // 6:30/km
  const warmup: LapSpec = { duration: 600, speed: 2.9 };
  const cooldown: LapSpec = { duration: 300, speed: 2.8 };

  it("detects 10×(3' @ 4:30 / 1' @ 6:30) in pace", () => {
    const specs = [warmup, ...repeat(10, work, recovery), cooldown];
    const result = detectRun(specs);
    expect(result?.metric).toBe("pace");
    const block = result!.blocks[0];
    expect(block.reps).toBe(10);
    expect(block.workDuration).toBe(180);
    expect(block.work.value).toBe(270);
    expect(block.recoveryDuration).toBe(60);
    expect(block.recovery?.value).toBe(390);
    expect(result?.confident).toBe(true);
  });

  it("detects a nested 2×(5×3') split by a long set break", () => {
    const setBreak: LapSpec = { duration: 300, speed: paceToSpeed(390) };
    const specs = [
      warmup,
      ...repeat(4, work, recovery),
      work,
      setBreak,
      ...repeat(4, work, recovery),
      work,
      cooldown,
    ];
    const result = detectRun(specs, 3.5);
    expect(result?.blocks).toHaveLength(1);
    const block = result!.blocks[0];
    expect(block.sets).toBe(2);
    expect(block.reps).toBe(5);
    expect(block.workDuration).toBe(180);
    expect(block.work.value).toBe(270);
    expect(block.work.zoneName).toBe("Zone 5b");
    expect(block.recoveryDuration).toBe(60);
    expect(block.recovery?.value).toBe(390);
    expect(block.recovery?.zoneName).toBe("Zone 1");
    expect(result?.confident).toBe(true);
  });

  it("rejects a fartlek with erratic durations", () => {
    const specs: LapSpec[] = [
      { duration: 600, speed: 2.9 },
      { duration: 300, speed: 3.3 },
      { duration: 120, speed: 3.0 },
      { duration: 400, speed: 3.4 },
      { duration: 90, speed: 3.0 },
      { duration: 500, speed: 3.5 },
      { duration: 60, speed: 3.0 },
      { duration: 200, speed: 3.6 },
      { duration: 300, speed: 2.9 },
    ];
    expect(detectRun(specs)).toBeNull();
  });
});

describe("detectWorkoutStructure — degenerate inputs", () => {
  it("returns null for unsupported sports", () => {
    const laps = makeLaps(
      repeat(5, { duration: 60, speed: 2 }, { duration: 60, speed: 1 }),
    );
    expect(detectWorkoutStructure({ laps, activityType: "Swim" })).toBeNull();
    expect(detectWorkoutStructure({ laps, activityType: "Hike" })).toBeNull();
  });

  it("returns null for 0, 1 or 2 laps", () => {
    expect(
      detectWorkoutStructure({ laps: [], activityType: "Run" }),
    ).toBeNull();
    expect(
      detectWorkoutStructure({
        laps: makeLaps([{ duration: 3600, speed: 3 }]),
        activityType: "Run",
      }),
    ).toBeNull();
    expect(
      detectWorkoutStructure({
        laps: makeLaps([
          { duration: 600, watts: 150 },
          { duration: 60, watts: 300 },
        ]),
        activityType: "Ride",
      }),
    ).toBeNull();
  });
});
