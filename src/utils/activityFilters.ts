import { format, isValid, parseISO, subDays } from "date-fns";
import { z } from "zod";

import type { AppMessageKey } from "~/i18n/I18nProvider";
import { WORKOUT_KINDS } from "~/utils/sportConfig";

export const FILTER_FIELDS = [
  { id: "sport", kind: "set" },
  { id: "date", kind: "date" },
  { id: "workoutKind", kind: "set" },
  { id: "commute", kind: "boolean" },
  { id: "name", kind: "text" },
  { id: "distance", kind: "number", scale: 1000 },
  { id: "duration", kind: "number", scale: 60 },
  { id: "elevation", kind: "number", scale: 1 },
  { id: "heartrate", kind: "number", scale: 1 },
  { id: "power", kind: "number", scale: 1 },
  { id: "route", kind: "presence" },
] as const;

export type FilterField = (typeof FILTER_FIELDS)[number]["id"];
const FILTER_OPERATORS = [
  "in",
  "notIn",
  "eq",
  "ne",
  "gt",
  "ge",
  "lt",
  "le",
  "between",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "blank",
  "notBlank",
  "last",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface ActivityCondition {
  kind: "condition";
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value: string;
  valueTo: string;
  values: string[];
}

export interface ActivityFilterGroup {
  kind: "group";
  id: string;
  join: "AND" | "OR";
  children: ActivityFilterNode[];
}

export type ActivityFilterNode = ActivityFilterGroup | ActivityCondition;

export const EMPTY_ACTIVITY_FILTER: ActivityFilterGroup = {
  kind: "group",
  id: "root",
  join: "AND",
  children: [],
};

const scalarOperators = [
  "eq",
  "ne",
  "gt",
  "ge",
  "lt",
  "le",
  "between",
] as const;
export function getFilterOperators(field: FilterField): FilterOperator[] {
  const definition = FILTER_FIELDS.find((f) => f.id === field)!;
  switch (definition.kind) {
    case "set":
      return ["in", "notIn"];
    case "boolean":
      return ["eq"];
    case "presence":
      return ["notBlank", "blank"];
    case "text":
      return ["contains", "notContains", "eq", "ne", "startsWith", "endsWith"];
    case "date":
      return [...scalarOperators, "last"];
    case "number":
      return [...scalarOperators, "blank", "notBlank"];
  }
}

export function isCalendarDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    isValid(parseISO(value)) &&
    format(parseISO(value), "yyyy-MM-dd") === value
  );
}

export function conditionError(
  condition: ActivityCondition,
): AppMessageKey | null {
  const definition = FILTER_FIELDS.find((f) => f.id === condition.field);
  if (
    !definition ||
    !getFilterOperators(condition.field).includes(condition.operator)
  )
    return "views.errors.condition";
  if (condition.operator === "blank" || condition.operator === "notBlank")
    return null;
  if (definition.kind === "set") {
    if (!condition.values.length || condition.values.some((v) => !v.trim()))
      return "views.errors.value";
    if (
      condition.field === "workoutKind" &&
      condition.values.some(
        (v) => !(WORKOUT_KINDS as readonly string[]).includes(v),
      )
    )
      return "views.errors.value";
    return null;
  }
  if (definition.kind === "boolean")
    return ["true", "false"].includes(condition.value)
      ? null
      : "views.errors.value";
  if (!condition.value.trim()) return "views.errors.value";
  if (condition.operator === "last")
    return /^\d+$/.test(condition.value) &&
      Number(condition.value) > 0 &&
      Number(condition.value) <= 36500
      ? null
      : "views.errors.value";
  const valid = (v: string) =>
    definition.kind === "date"
      ? isCalendarDate(v)
      : definition.kind === "number"
        ? v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0
        : true;
  if (!valid(condition.value)) return "views.errors.value";
  if (condition.operator === "between") {
    if (!valid(condition.valueTo)) return "views.errors.value";
    if (
      definition.kind === "number"
        ? Number(condition.value) > Number(condition.valueTo)
        : condition.value > condition.valueTo
    )
      return "views.errors.range";
  }
  return null;
}

const conditionSchema = z.object({
  kind: z.literal("condition"),
  id: z.string().min(1).max(100),
  field: z.enum(FILTER_FIELDS.map((f) => f.id)),
  operator: z.enum(FILTER_OPERATORS),
  value: z.string().max(500),
  valueTo: z.string().max(500),
  values: z.array(z.string().min(1).max(100)).max(100),
});
const nodeSchema: z.ZodType<ActivityFilterNode> = z.lazy(() =>
  z.union([
    conditionSchema,
    z.object({
      kind: z.literal("group"),
      id: z.string().min(1).max(100),
      join: z.enum(["AND", "OR"]),
      children: z.array(nodeSchema).max(100),
    }),
  ]),
);

export const activityRulesSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const stack = [{ value, depth: 0 }];
    let count = 0;
    while (stack.length) {
      const item = stack.pop()!;
      if (++count > 100 || item.depth > 8) {
        ctx.addIssue({
          code: "custom",
          message: "Filter exceeds 100 nodes or 8 nesting levels",
        });
        return;
      }
      if (
        item.value &&
        typeof item.value === "object" &&
        "children" in item.value &&
        Array.isArray(item.value.children)
      ) {
        stack.push(
          ...item.value.children.map((child: unknown) => ({
            value: child,
            depth: item.depth + 1,
          })),
        );
      }
    }
  })
  .pipe(nodeSchema)
  .superRefine((root, ctx) => {
    const ids = new Set<string>();
    function visit(node: ActivityFilterNode) {
      if (ids.has(node.id))
        ctx.addIssue({ code: "custom", message: "Duplicate filter node ID" });
      ids.add(node.id);
      if (node.kind === "condition") {
        const error = conditionError(node);
        if (error) ctx.addIssue({ code: "custom", message: error });
      } else {
        if (node !== root && !node.children.length)
          ctx.addIssue({
            code: "custom",
            message: "A nested group needs a condition",
          });
        node.children.forEach(visit);
      }
    }
    if (root.kind !== "group")
      ctx.addIssue({
        code: "custom",
        message: "The filter root must be a group",
      });
    visit(root);
  })
  .transform((node) => node as ActivityFilterGroup);

export const ACTIVITY_COLUMNS = [
  "type",
  "name",
  "startDateLocal",
  "distance",
  "totalElevationGain",
  "movingTime",
  "averageSpeed",
  "load",
] as const;
export const activityDisplaySchema = z.object({
  columns: z
    .array(z.enum(ACTIVITY_COLUMNS))
    .min(1)
    .max(ACTIVITY_COLUMNS.length)
    .refine((columns) => new Set(columns).size === columns.length),
  sort: z.object({ id: z.enum(ACTIVITY_COLUMNS), desc: z.boolean() }),
  groupBy: z.enum(["none", "sport", "month"]),
});
export type ActivityDisplay = z.infer<typeof activityDisplaySchema>;
export const DEFAULT_ACTIVITY_DISPLAY: ActivityDisplay = {
  columns: [...ACTIVITY_COLUMNS],
  sort: { id: "startDateLocal", desc: true },
  groupBy: "none",
};

export function createCondition(
  field: FilterField = "sport",
): ActivityCondition {
  return {
    kind: "condition",
    id: crypto.randomUUID(),
    field,
    operator: getFilterOperators(field)[0],
    value: field === "commute" ? "false" : "",
    valueTo: "",
    values: [],
  };
}
export function createFilterGroup(): ActivityFilterGroup {
  return {
    kind: "group",
    id: crypto.randomUUID(),
    join: "AND",
    children: [createCondition()],
  };
}
export function updateFilterNode(
  root: ActivityFilterGroup,
  id: string,
  update: (node: ActivityFilterNode) => ActivityFilterNode | null,
): ActivityFilterGroup {
  const visit = (node: ActivityFilterNode): ActivityFilterNode | null => {
    if (node.id === id) return update(node);
    return node.kind === "group"
      ? { ...node, children: node.children.map(visit).filter((n) => n != null) }
      : node;
  };
  return (visit(root) ?? EMPTY_ACTIVITY_FILTER) as ActivityFilterGroup;
}
export function filterGroupIds(root: ActivityFilterGroup): string[] {
  return [
    root.id,
    ...root.children.flatMap((n) =>
      n.kind === "group" ? filterGroupIds(n) : [],
    ),
  ];
}
export function conditionCount(root: ActivityFilterGroup): number {
  return root.children.reduce(
    (sum, node) => sum + (node.kind === "group" ? conditionCount(node) : 1),
    0,
  );
}
/**
 * The same selection with structural IDs and without the values its operators
 * ignore, so equal selections send equal query inputs and share cached results.
 */
export function canonicalRules(root: ActivityFilterGroup): ActivityFilterGroup {
  let id = 0;
  // Depth-first from `n1`, the numbering links decode to.
  const visit = (node: ActivityFilterNode): ActivityFilterNode => {
    const nodeId = `n${++id}`;
    if (node.kind === "group")
      return {
        kind: "group",
        id: nodeId,
        join: node.join,
        children: node.children.map(visit),
      };
    const list = node.operator === "in" || node.operator === "notIn";
    const blank = node.operator === "blank" || node.operator === "notBlank";
    return {
      kind: "condition",
      id: nodeId,
      field: node.field,
      operator: node.operator,
      value: list || blank ? "" : node.value,
      valueTo: node.operator === "between" ? node.valueTo : "",
      values: list ? node.values : [],
    };
  };
  return visit(root) as ActivityFilterGroup;
}
export function sameFilter(
  a: ActivityFilterGroup,
  b: ActivityFilterGroup,
): boolean {
  // The order of a condition's values does not change what it matches.
  const key = (root: ActivityFilterGroup) =>
    JSON.stringify(canonicalRules(root), (name, value: unknown) =>
      name === "values" ? [...(value as string[])].sort() : value,
    );
  return key(a) === key(b);
}
/** Key-order independent: stored views and parsed URLs order keys differently. */
export function sameDisplay(a: ActivityDisplay, b: ActivityDisplay): boolean {
  return (
    a.groupBy === b.groupBy &&
    a.sort.id === b.sort.id &&
    a.sort.desc === b.sort.desc &&
    a.columns.length === b.columns.length &&
    a.columns.every((column, index) => column === b.columns[index])
  );
}
export function rollingDateRange(
  days: number,
  today: string,
): [string, string] {
  return [format(subDays(parseISO(today), days - 1), "yyyy-MM-dd"), today];
}
