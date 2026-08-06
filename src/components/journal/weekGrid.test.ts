import { describe, expect, it } from "vitest";

import type { PlannedTraining } from "@server/db/types";

import type { JournalActivity, JournalDay } from "./useJournalWeeks";
import { buildDayEvents, coveredDayKeys } from "./weekGrid";

const HOUR = 3600;

function makeDay(date: string, overrides?: Partial<JournalDay>): JournalDay {
  return {
    date: new Date(`${date}T00:00:00`),
    isToday: false,
    activities: [],
    plannedTrainings: [],
    busyEvents: [],
    totalLoad: 0,
    ...overrides,
  };
}

describe("coveredDayKeys", () => {
  it("keeps a same-day event on its start day only", () => {
    expect(coveredDayKeys("2026-08-03T10:00:00", HOUR)).toEqual(["2026-08-03"]);
  });

  it("does not spill onto the next day when ending exactly at midnight", () => {
    expect(coveredDayKeys("2026-08-03T22:00:00", 2 * HOUR)).toEqual([
      "2026-08-03",
    ]);
  });

  it("covers every day a multi-day event touches, across month boundaries", () => {
    // Sunday 08:00 + 48h ends Tuesday 08:00, crossing into September.
    expect(coveredDayKeys("2026-08-30T08:00:00", 48 * HOUR)).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
  });

  it("caps the fan-out so a runaway duration cannot explode the journal range", () => {
    expect(
      coveredDayKeys("2026-08-03T00:00:00", 1000 * 24 * HOUR),
    ).toHaveLength(91);
  });
});

describe("buildDayEvents multi-day segments", () => {
  // Monday 18:00 + 40h ends Wednesday 10:00 — three segments.
  const training = {
    id: 7,
    plannedDate: "2026-08-03T18:00:00",
    durationSeconds: 40 * HOUR,
  } as PlannedTraining;

  it("renders the start-day segment from its start time to midnight", () => {
    const [event] = buildDayEvents(
      makeDay("2026-08-03", { plannedTrainings: [training] }),
    );
    expect(event).toMatchObject({
      id: "planned-7",
      startMinutes: 18 * 60,
      endMinutes: 24 * 60,
      continued: false,
    });
  });

  it("renders a full-day continuation segment on a fully covered day", () => {
    const [event] = buildDayEvents(
      makeDay("2026-08-04", { plannedTrainings: [training] }),
    );
    expect(event).toMatchObject({
      id: "planned-7-day1",
      startMinutes: 0,
      endMinutes: 24 * 60,
      continued: true,
    });
  });

  it("renders the final segment from midnight to the event's end", () => {
    const [event] = buildDayEvents(
      makeDay("2026-08-05", { plannedTrainings: [training] }),
    );
    expect(event).toMatchObject({
      id: "planned-7-day2",
      startMinutes: 0,
      endMinutes: 10 * 60,
      continued: true,
    });
  });

  it("segments overnight activities the same way", () => {
    const activity = {
      stravaId: 42,
      startDateLocal: "2026-08-03T23:00:00",
      elapsedTime: 3 * HOUR,
    } as JournalActivity;
    const [event] = buildDayEvents(
      makeDay("2026-08-04", { activities: [activity] }),
    );
    expect(event).toMatchObject({
      id: "activity-42-day1",
      startMinutes: 0,
      endMinutes: 2 * 60,
      continued: true,
    });
  });
});
