import { format, parseISO } from "date-fns";
import { z } from "zod";

import type { SlicePrecision } from "~/hooks/useTimeSlices";
import {
  type ActivityFilterGroup,
  activityRulesSchema,
  isCalendarDate,
} from "~/utils/activityFilters";
import { endOf } from "~/utils/dateUtils";

// The inspection only: the metric and precision are the view's chart settings
// (see `useViewChartSettings`). Links from before that split still carry them,
// which parsing ignores.
const schema = z.object({
  period: z.string().refine(isCalendarDate).optional(),
  sport: z.string().max(100).optional(),
  hidden: z.array(z.string().max(100)).max(100),
  zoom: z
    .object({
      start: z.number().min(0).max(100),
      end: z.number().min(0).max(100),
    })
    .refine(({ start, end }) => start < end)
    .optional(),
});

export type TimelineState = z.infer<typeof schema>;
export const DEFAULT_TIMELINE_STATE: TimelineState = { hidden: [] };

export function readTimelineState(value: unknown): TimelineState {
  try {
    return schema.parse(JSON.parse(typeof value === "string" ? value : ""));
  } catch {
    return DEFAULT_TIMELINE_STATE;
  }
}

/** Intersect the entire selection, including a root OR, with the inspected bucket. */
export function timelineSelection(
  rules: ActivityFilterGroup,
  period: string,
  precision: SlicePrecision,
  sports: string[],
) {
  return activityRulesSchema.safeParse({
    kind: "group",
    id: "timeline-root",
    join: "AND",
    children: [
      ...(rules.join === "AND" ? rules.children : [rules]),
      {
        kind: "condition",
        id: "timeline-date",
        field: "date",
        operator: "between",
        value: period,
        valueTo: format(endOf(parseISO(period), precision), "yyyy-MM-dd"),
        values: [],
      },
      {
        kind: "condition",
        id: "timeline-sports",
        field: "sport",
        operator: "in",
        value: "",
        valueTo: "",
        values: sports,
      },
    ],
  });
}
