import { type SQL, and, eq, gte, inArray, is, lte, sql } from "drizzle-orm";
import { type BuildAliasTable, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { Database } from "../db";
import { activities, timePeriods } from "../db/schema";

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD format");

/**
 * The filter every endpoint that selects activities accepts, next to the
 * `athleteId` that `athleteProcedure` checks. The client sends whatever its view
 * decided (see `useActivitySelection`), so each field has to mean the same
 * thing everywhere: that is {@link selectActivities}' job.
 */
export const activityFilterInput = z.object({
  activityTypes: z.array(z.string().max(50)).optional(),
  workoutTypes: z.array(z.number().int()).optional(),
  hideCommutes: z.boolean().optional(),
  timePeriodId: z.number().int().positive().optional(),
  dateFrom: calendarDate.optional(),
  dateTo: calendarDate.optional(),
});

type ActivitiesTable =
  typeof activities | BuildAliasTable<typeof activities, string>;

type TimePeriodsTable =
  typeof timePeriods | BuildAliasTable<typeof timePeriods, string>;

interface TimePeriodBounds {
  startDate: string;
  endDate: string;
  sportTypes: string[] | null;
}

export type ActivitySelection = z.infer<typeof activityFilterInput> & {
  athleteId: number;
  /**
   * Replaces the `timePeriodId` lookup for callers that already hold the
   * period: its row, or the `time_periods` table (or an alias) when the query
   * joins every period and each row bounds its own activities.
   */
  timePeriod?: TimePeriodBounds | TimePeriodsTable;
};

/**
 * The SQL condition matching the athlete's activities that `selection`
 * describes, for a Drizzle `.where()` or a raw `sql` template.
 *
 * Dates are calendar days (YYYY-MM-DD) compared with the UTC `start_date`, and
 * both ends are inclusive: `dateTo: "2024-12-31"` keeps activities started up
 * to 23:59:59 UTC that day. A time period contributes its dates and its sports;
 * `dateFrom` and `dateTo` replace the matching period date. A `timePeriodId`
 * that isn't one of the athlete's periods is ignored.
 *
 * Raw SQL that names the table (`FROM activities a`) passes
 * `alias(activities, "a")` as `t`, so the condition refers to it by that name.
 */
export async function selectActivities(
  db: Database,
  selection: ActivitySelection,
  t: ActivitiesTable = activities,
): Promise<SQL> {
  const period =
    selection.timePeriod ??
    (selection.timePeriodId
      ? await findTimePeriod(db, selection.timePeriodId, selection.athleteId)
      : undefined);

  const conditions = [eq(t.athlete, selection.athleteId)];
  if (selection.activityTypes && selection.activityTypes.length > 0) {
    conditions.push(inArray(t.type, selection.activityTypes));
  }
  const periodSports = period && periodSportsCondition(period, t);
  if (periodSports) {
    conditions.push(periodSports);
  }
  if (selection.workoutTypes && selection.workoutTypes.length > 0) {
    conditions.push(inArray(t.workoutType, selection.workoutTypes));
  }
  if (selection.hideCommutes) {
    conditions.push(eq(t.commute, false));
  }
  const dateFrom = selection.dateFrom ?? period?.startDate;
  if (dateFrom) {
    conditions.push(gte(t.startDate, dateFrom));
  }
  const dateTo = selection.dateTo ?? period?.endDate;
  if (dateTo) {
    conditions.push(lte(t.startDate, endOfDay(dateTo)));
  }
  return and(...conditions)!;
}

function findTimePeriod(db: Database, id: number, athleteId: number) {
  return db.query.timePeriods.findFirst({
    where: and(eq(timePeriods.id, id), eq(timePeriods.athlete, athleteId)),
  });
}

/** The last second of `day`, which `start_date` (ISO UTC text) is compared with. */
function endOfDay(day: string | TimePeriodsTable["endDate"]): string | SQL {
  return typeof day === "string"
    ? `${day}T23:59:59Z`
    : sql`(${day} || 'T23:59:59Z')`;
}

/** A period with no sports (null or empty) keeps every sport. */
function periodSportsCondition(
  period: TimePeriodBounds | TimePeriodsTable,
  t: ActivitiesTable,
): SQL | undefined {
  if (isTable(period)) {
    const sports = period.sportTypes;
    return sql`(${sports} IS NULL OR ${sports} = '[]'::jsonb OR ${t.type} IN (SELECT jsonb_array_elements_text(${sports})))`;
  }
  const sports = period.sportTypes;
  return sports && sports.length > 0 ? inArray(t.type, sports) : undefined;
}

function isTable(
  period: TimePeriodBounds | TimePeriodsTable,
): period is TimePeriodsTable {
  return is(period, PgTable);
}
