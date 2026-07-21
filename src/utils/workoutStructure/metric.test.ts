import { describe, expect, it } from "vitest";

import { makeLaps, repeat } from "./fixtures";
import { extractLapPoints, selectMetric } from "./metric";

describe("selectMetric", () => {
  it("maps cycling types to power", () => {
    expect(selectMetric("Ride")).toBe("power");
    expect(selectMetric("VirtualRide")).toBe("power");
  });

  it("maps running types to pace", () => {
    expect(selectMetric("Run")).toBe("pace");
    expect(selectMetric("VirtualRun")).toBe("pace");
  });

  it("returns null for unsupported sports", () => {
    expect(selectMetric("Swim")).toBeNull();
    expect(selectMetric("Hike")).toBeNull();
    expect(selectMetric("WeightTraining")).toBeNull();
    expect(selectMetric("SomeUnknownType")).toBeNull();
  });
});

describe("extractLapPoints", () => {
  it("drops spurious sub-5s laps", () => {
    const laps = makeLaps([
      { duration: 60, watts: 280 },
      { duration: 2, watts: 500 },
      { duration: 30, watts: 100 },
    ]);
    const points = extractLapPoints(laps, "power");
    expect(points?.map((p) => p.duration)).toEqual([60, 30]);
  });

  it("uses watts as the value for power", () => {
    const laps = makeLaps([{ duration: 60, watts: 280, speed: 8 }]);
    expect(extractLapPoints(laps, "power")?.[0].value).toBe(280);
  });

  it("uses speed as the value for pace and drops stopped laps", () => {
    const laps = makeLaps([
      { duration: 60, speed: 3.7 },
      { duration: 60, speed: 0 },
    ]);
    const points = extractLapPoints(laps, "pace");
    expect(points?.map((p) => p.value)).toEqual([3.7]);
  });

  it("returns null when no cycling lap has watts", () => {
    const laps = makeLaps(repeat(5, { duration: 60 }, { duration: 30 }));
    expect(extractLapPoints(laps, "power")).toBeNull();
  });

  it("tolerates a single dropout lap out of 20", () => {
    const specs = repeat(
      10,
      { duration: 60, watts: 280 },
      { duration: 30, watts: 100 },
    );
    delete specs[5].watts;
    const points = extractLapPoints(makeLaps(specs), "power");
    expect(points).toHaveLength(19);
  });

  it("passes at exactly 90% availability and fails below it", () => {
    const twoMissing = repeat(
      10,
      { duration: 60, watts: 280 },
      { duration: 30, watts: 100 },
    );
    delete twoMissing[5].watts;
    delete twoMissing[9].watts;
    expect(extractLapPoints(makeLaps(twoMissing), "power")).toHaveLength(18);

    const threeMissing = repeat(
      10,
      { duration: 60, watts: 280 },
      { duration: 30, watts: 100 },
    );
    delete threeMissing[5].watts;
    delete threeMissing[9].watts;
    delete threeMissing[13].watts;
    expect(extractLapPoints(makeLaps(threeMissing), "power")).toBeNull();
  });
});
