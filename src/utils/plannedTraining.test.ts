import { describe, expect, it } from "vitest";

import {
  parsePlannedDate,
  plannedDateAt,
  plannedDateOf,
  plannedDay,
  plannedTime,
  plannedTrainingFields,
} from "./plannedTraining";

const acceptsPlannedDate = (value: string) =>
  plannedTrainingFields.plannedDate.safeParse(value).success;

describe("plannedDate", () => {
  it("builds the same value from the planner's inputs and from a clock, and the server accepts it", () => {
    const fromInputs = plannedDateOf("2026-03-04", "07:30");

    expect(fromInputs).toBe("2026-03-04T07:30:00");
    expect(plannedDateAt(new Date(2026, 2, 4, 7, 30))).toBe(fromInputs);
    expect(acceptsPlannedDate(fromInputs)).toBe(true);
  });

  it("reads back the local day, time and moment it was built from", () => {
    const value = plannedDateOf("2026-03-04", "07:30");

    expect(plannedDay(value)).toBe("2026-03-04");
    expect(plannedTime(value)).toBe("07:30");
    expect(parsePlannedDate(value)).toEqual(new Date(2026, 2, 4, 7, 30));
  });

  // A UTC instant would shift the plan by the athlete's offset, and a missing
  // part breaks the string compares the list bounds rely on.
  it.each(["2026-03-04", "2026-03-04T07:30", "2026-03-04T06:30:00.000Z"])(
    "is refused by the server as %s",
    (value) => {
      expect(acceptsPlannedDate(value)).toBe(false);
    },
  );
});
