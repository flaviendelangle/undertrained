import { format } from "date-fns";
import { z } from "zod";

/**
 * The rules for a planned training that the client and the server both apply:
 * the shape of `plannedDate` and the limits on each field. The server validates
 * create and update with {@link plannedTrainingFields}. Build and read
 * `plannedDate` with the helpers below rather than by slicing the string.
 *
 * `plannedDate` is a floating-local datetime, `yyyy-MM-ddTHH:mm:ss`: the
 * athlete's wall clock with no zone attached, like an activity's
 * `startDateLocal`. In that shape a plain string compare is a chronological one,
 * which the list's `from`/`to` bounds and the link prompt's "is it due yet"
 * check both rely on.
 */

const PLANNED_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** Longest plan the server accepts. The planner's duration field stops here. */
export const MAX_PLANNED_DURATION_SECONDS = 24 * 3600;

/** Field validators for create and update. */
export const plannedTrainingFields = {
  title: z.string().trim().min(1).max(200),
  plannedDate: z.string().regex(PLANNED_DATE_PATTERN),
  durationSeconds: z
    .number()
    .int()
    .positive()
    .max(MAX_PLANNED_DURATION_SECONDS),
  sportType: z.string().min(1),
};

/** A `plannedDate` from a date input's and a time input's values. */
export function plannedDateOf(day: string, time: string): string {
  return `${day}T${time}:00`;
}

/** The `plannedDate` of a moment on the local wall clock. */
export function plannedDateAt(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm:ss");
}

/** The local calendar day (`yyyy-MM-dd`) a plan starts on. */
export function plannedDay(plannedDate: string): string {
  return plannedDate.slice(0, 10);
}

/** The local start time (`HH:mm`) of a plan. */
export function plannedTime(plannedDate: string): string {
  return plannedDate.slice(11, 16);
}

/**
 * The start of a plan as a `Date`, for formatting and calendar math. A
 * date-time string without an offset parses as local time, which is what a
 * floating-local value means.
 */
export function parsePlannedDate(plannedDate: string): Date {
  return new Date(plannedDate);
}
