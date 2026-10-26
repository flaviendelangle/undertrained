import {
  type SQL,
  and,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { type BuildAliasTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import {
  type ActivityFilterNode,
  FILTER_FIELDS,
  activityRulesSchema,
  isCalendarDate,
  rollingDateRange,
} from "~/utils/activityFilters";
import { type WorkoutKind, workoutTypesOfKind } from "~/utils/sportConfig";

import { activities } from "../db/schema";

const calendarDate = z
  .string()
  .refine(isCalendarDate, "Expected a valid YYYY-MM-DD date");

/**
 * The filter every endpoint that selects activities accepts, next to the
 * `athleteId` that `athleteProcedure` checks. The client sends whatever its view
 * decided (see `useActivitySelection`), so each field has to mean the same
 * thing everywhere: that is {@link selectActivities}' job.
 */
export const activityFilterInput = z.object({
  rules: activityRulesSchema.optional(),
  today: calendarDate.optional(),
  activityTypes: z.array(z.string().max(50)).optional(),
  workoutTypes: z.array(z.number().int()).optional(),
  hideCommutes: z.boolean().optional(),
  dateFrom: calendarDate.optional(),
  dateTo: calendarDate.optional(),
});

type ActivitiesTable =
  typeof activities | BuildAliasTable<typeof activities, string>;

export type ActivitySelection = z.infer<typeof activityFilterInput> & {
  athleteId: number;
};

/**
 * The SQL condition matching the athlete's activities that `selection`
 * describes, for a Drizzle `.where()` or a raw `sql` template.
 *
 * Dates compare each activity's local calendar day, with inclusive bounds.
 * Nested rules always intersect the athlete, sport and explicit date inputs.
 *
 * Raw SQL that names the table (`FROM activities a`) passes
 * `alias(activities, "a")` as `t`, so the condition refers to it by that name.
 */
export function selectActivities(
  selection: ActivitySelection,
  t: ActivitiesTable = activities,
): SQL {
  const conditions = [eq(t.athlete, selection.athleteId)];
  if (selection.rules)
    conditions.push(activityRuleCondition(selection.rules, t, selection.today));
  if (selection.activityTypes && selection.activityTypes.length > 0) {
    conditions.push(inArray(t.type, selection.activityTypes));
  }
  if (selection.workoutTypes && selection.workoutTypes.length > 0) {
    conditions.push(inArray(t.workoutType, selection.workoutTypes));
  }
  if (selection.hideCommutes) {
    conditions.push(eq(t.commute, false));
  }
  const dateFrom = selection.dateFrom;
  if (dateFrom) {
    conditions.push(gte(sql<string>`left(${t.startDateLocal}, 10)`, dateFrom));
  }
  const dateTo = selection.dateTo;
  if (dateTo) {
    conditions.push(lte(sql<string>`left(${t.startDateLocal}, 10)`, dateTo));
  }
  return and(...conditions)!;
}

/** Compiles validated rules; every OR remains inside the athlete's condition. */
export function activityRuleCondition(
  node: ActivityFilterNode,
  t: ActivitiesTable = activities,
  today = new Date().toISOString().slice(0, 10),
): SQL {
  if (node.kind === "group") {
    const conditions = node.children.map((child) =>
      activityRuleCondition(child, t, today),
    );
    return (
      (node.join === "AND" ? and(...conditions) : or(...conditions)) ??
      sql`true`
    );
  }
  const { field, operator, value, valueTo, values } = node;
  if (field === "workoutKind") {
    const types = values.flatMap((kind) =>
      workoutTypesOfKind(kind as WorkoutKind),
    );
    const kinds = [inArray(t.workoutType, types)];
    if (values.includes("none")) kinds.push(isNull(t.workoutType));
    const condition = or(...kinds)!;
    // COALESCE makes an unclassified workout a real non-match under NOT.
    return operator === "notIn"
      ? sql`not coalesce(${condition}, false)`
      : condition;
  }
  if (field === "sport")
    return operator === "notIn"
      ? notInArray(t.type, values)
      : inArray(t.type, values);
  if (field === "commute") return eq(t.commute, value === "true");
  const columns = {
    name: t.name,
    date: sql<string>`left(${t.startDateLocal}, 10)`,
    distance: t.distance,
    duration: t.movingTime,
    elevation: t.totalElevationGain,
    heartrate: t.averageHeartrate,
    power: t.averageWatts,
    route: t.mapPolyline,
  };
  const column = sql`${columns[field]}`;
  if (operator === "blank")
    return field === "route"
      ? or(isNull(column), eq(column, ""))!
      : isNull(column);
  if (operator === "notBlank")
    return field === "route"
      ? and(isNotNull(column), ne(column, ""))!
      : isNotNull(column);
  if (operator === "last") {
    const [from, to] = rollingDateRange(Number(value), today);
    return and(gte(column, from), lte(column, to))!;
  }
  const definition = FILTER_FIELDS.find((f) => f.id === field)!;
  const operand = (input: string) =>
    definition.kind === "number" ? Number(input) * definition.scale : input;
  const escapeLike = (input: string) => input.replace(/[\\%_]/g, "\\$&");
  switch (operator) {
    case "eq":
      return eq(column, operand(value));
    case "ne":
      return ne(column, operand(value));
    case "gt":
      return gt(column, operand(value));
    case "ge":
      return gte(column, operand(value));
    case "lt":
      return lt(column, operand(value));
    case "le":
      return lte(column, operand(value));
    case "between":
      return and(gte(column, operand(value)), lte(column, operand(valueTo)))!;
    case "contains":
      return ilike(column, `%${escapeLike(value)}%`);
    case "notContains":
      return not(ilike(column, `%${escapeLike(value)}%`));
    case "startsWith":
      return ilike(column, `${escapeLike(value)}%`);
    case "endsWith":
      return ilike(column, `%${escapeLike(value)}`);
    default:
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Unsupported filter operator",
      });
  }
}
