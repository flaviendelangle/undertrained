import { describe, expect, it } from "vitest";

import { RIDER_FIELD_CONFIG, formatFieldDelta } from "./fieldConfig";

const config = (field: string) =>
  RIDER_FIELD_CONFIG.find((c) => c.field === field)!;

describe("formatFieldDelta", () => {
  it("signs the change in the field's unit", () => {
    expect(formatFieldDelta(config("ftp"), 250, 260)).toBe("+10 W");
    expect(formatFieldDelta(config("restingHr"), 50, 46)).toBe("−4 bpm");
  });

  it("keeps a tenth for fractional values", () => {
    expect(formatFieldDelta(config("weightKg"), 70, 69.2)).toBe("−0.8 kg");
  });

  it("returns null when the value didn't move", () => {
    expect(formatFieldDelta(config("ftp"), 260, 260)).toBeNull();
  });

  it("measures a pace in seconds, so getting faster reads as negative", () => {
    // 4:20 /km → 4:05 /km
    expect(
      formatFieldDelta(config("runThresholdPace"), 1000 / 260, 1000 / 245),
    ).toBe("−15 s");
    // 1:45 /100m → 2:50 /100m
    expect(
      formatFieldDelta(config("swimThresholdPace"), 100 / 105, 100 / 170),
    ).toBe("+1:05");
  });
});
