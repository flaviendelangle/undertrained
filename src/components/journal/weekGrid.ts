import type { PlannedTraining } from "@server/db/types";
import type { BusyEvent } from "@server/lib/icalFeed";

import type { JournalActivity, JournalDay } from "./useJournalWeeks";

/** Pixel height of a single hour row in the week time-grid. */
export const HOUR_HEIGHT = 48;

/** Pixel width of the sticky hour-axis gutter (numeric form of `3.25rem`). */
export const GUTTER_WIDTH_PX = 52;

/** Pixel height of the sticky week-header row (day names + week picker). */
export const HEADER_HEIGHT_PX = 60;

/**
 * Fixed pixel height of the all-day strip slotted below the day-header row,
 * sized to hold a single all-day event (extra events on a day clip). Shared by
 * the columns and the hour-axis gutter so they stay aligned.
 */
export const ALLDAY_ROW_HEIGHT = 24;

/** Hour offsets 0..23, used by both the time-axis labels and the column gridlines. */
export const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Total minutes in a day, the vertical extent of the grid. */
export const MINUTES_PER_DAY = 24 * 60;

/** Snap dropped events to this minute granularity when rescheduling. */
export const SNAP_MINUTES = 15;

/** Minimum rendered block height so very short sessions stay legible. */
export const MIN_BLOCK_HEIGHT = 18;

/**
 * Below this height a block can't fit a second line, so only its title renders
 * (the stats / time line is dropped) to avoid overflowing the block.
 */
export const COMPACT_BLOCK_HEIGHT = 34;

/** One pixel = this many minutes, derived from the hour height. */
export const MINUTES_PER_PIXEL = 60 / HOUR_HEIGHT;

/**
 * A single timed entry in the week grid — either a completed activity or a
 * still-planned training — reduced to the start/duration the layout needs while
 * keeping the source object for rendering.
 */
export type WeekEvent =
  | {
      kind: "activity";
      id: string;
      activity: JournalActivity;
      startMinutes: number;
      endMinutes: number;
    }
  | {
      kind: "planned";
      id: string;
      training: PlannedTraining;
      startMinutes: number;
      endMinutes: number;
    }
  | {
      kind: "busy";
      id: string;
      busy: BusyEvent;
      startMinutes: number;
      endMinutes: number;
    };

/** A {@link WeekEvent} with its resolved geometry within a day column. */
export interface PositionedEvent {
  event: WeekEvent;
  /** Offset from the top of the grid, in pixels. */
  top: number;
  /** Rendered height, in pixels (clamped to {@link MIN_BLOCK_HEIGHT}). */
  height: number;
  /** Horizontal offset within the day column, as a percentage [0, 100). */
  leftPct: number;
  /** Width within the day column, as a percentage (0, 100]. */
  widthPct: number;
}

/**
 * Minutes since local midnight encoded in a floating-local ISO datetime string
 * (`YYYY-MM-DDTHH:mm:ss`). Parsing the string avoids any timezone shift — both
 * `startDateLocal` and `plannedDate` are already expressed in the athlete's
 * local time.
 */
export function minutesFromIso(iso: string): number {
  const hours = Number(iso.slice(11, 13));
  const minutes = Number(iso.slice(14, 16));
  return hours * 60 + minutes;
}

/** Format minutes-past-midnight as `HH:mm`. */
export function minutesToTimeLabel(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Round to the nearest {@link SNAP_MINUTES}, clamped to the day. */
export function snapMinutes(minutes: number): number {
  const snapped = Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(0, Math.min(MINUTES_PER_DAY - SNAP_MINUTES, snapped));
}

/** The timed events of a day, activities and still-planned trainings combined. */
export function buildDayEvents(day: JournalDay): WeekEvent[] {
  const events: WeekEvent[] = [];
  for (const activity of day.activities) {
    const start = minutesFromIso(activity.startDateLocal);
    events.push({
      kind: "activity",
      id: `activity-${activity.stravaId}`,
      activity,
      startMinutes: start,
      endMinutes: Math.min(MINUTES_PER_DAY, start + activity.elapsedTime / 60),
    });
  }
  for (const training of day.plannedTrainings) {
    const start = minutesFromIso(training.plannedDate);
    events.push({
      kind: "planned",
      id: `planned-${training.id}`,
      training,
      startMinutes: start,
      endMinutes: Math.min(MINUTES_PER_DAY, start + training.durationSeconds / 60),
    });
  }
  return events;
}

/**
 * The day's *timed* external-calendar busy events, packed in their own layer
 * behind the training blocks. All-day events are skipped here — they surface as a
 * chip in the day header instead, since they don't occupy specific hours.
 */
export function buildBusyEvents(day: JournalDay): WeekEvent[] {
  const events: WeekEvent[] = [];
  day.busyEvents.forEach((busy, index) => {
    if (busy.allDay) {
      return;
    }
    const start = minutesFromIso(busy.startLocal);
    const rawEnd = minutesFromIso(busy.endLocal);
    // A feed event can cross midnight; like activities, clamp it to the day end.
    const endMinutes = rawEnd > start ? Math.min(MINUTES_PER_DAY, rawEnd) : MINUTES_PER_DAY;
    events.push({
      kind: "busy",
      id: `busy-${busy.subscriptionId}-${index}-${busy.startLocal}`,
      busy,
      startMinutes: start,
      endMinutes,
    });
  });
  return events;
}

/**
 * Lay a day's events out side-by-side so overlaps don't hide each other, using
 * the classic calendar column-packing: events are grouped into clusters of
 * mutually-overlapping items, each cluster is split into the fewest columns
 * that keep its events disjoint, and every event is widened to its column share.
 */
export function packDayEvents(events: WeekEvent[]): PositionedEvent[] {
  const sorted = [...events].sort(
    (a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes,
  );

  const result: PositionedEvent[] = [];
  // Columns of the current cluster; each column is the events placed in it.
  let columns: WeekEvent[][] = [];
  let clusterEnd = -1;

  const flush = () => {
    const columnCount = columns.length;
    for (let col = 0; col < columnCount; col += 1) {
      for (const event of columns[col]) {
        const top = (event.startMinutes / 60) * HOUR_HEIGHT;
        const rawHeight =
          ((event.endMinutes - event.startMinutes) / 60) * HOUR_HEIGHT;
        result.push({
          event,
          top,
          height: Math.max(MIN_BLOCK_HEIGHT, rawHeight),
          leftPct: (col / columnCount) * 100,
          widthPct: (1 / columnCount) * 100,
        });
      }
    }
    columns = [];
    clusterEnd = -1;
  };

  for (const event of sorted) {
    // A gap with no overlap closes the current cluster.
    if (clusterEnd !== -1 && event.startMinutes >= clusterEnd) {
      flush();
    }
    let placed = false;
    for (const column of columns) {
      if (column[column.length - 1].endMinutes <= event.startMinutes) {
        column.push(event);
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([event]);
    }
    clusterEnd = Math.max(clusterEnd, event.endMinutes);
  }
  flush();

  return result;
}
