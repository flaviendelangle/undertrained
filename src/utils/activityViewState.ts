import {
  type ActivityDisplay,
  type ActivityFilterGroup,
  type ActivityFilterNode,
  activityDisplaySchema,
  activityRulesSchema,
} from "./activityFilters";

export interface ActivityViewState {
  viewId?: number;
  rules?: ActivityFilterGroup;
  display?: ActivityDisplay;
}
export const ACTIVITY_VIEW_PARAMS = ["view", "rules", "display"] as const;
/** The Activities pages that share, and edit, the activity selection. */
export const ACTIVITY_PRESENTATION_PATHS = {
  list: "/activities",
  map: "/activities/map",
  charts: "/activities/charts",
} as const;

/** An invalid link is an error, never an implicit unfiltered selection. */
export function readActivityViewState(
  query: Record<string, string | string[] | undefined>,
): ActivityViewState | null {
  try {
    if (ACTIVITY_VIEW_PARAMS.some((key) => Array.isArray(query[key])))
      return null;
    if (query.rules === "" || query.display === "") return null;
    const view = query.view;
    if (
      view !== undefined &&
      (typeof view !== "string" ||
        !/^[1-9]\d*$/.test(view) ||
        !Number.isSafeInteger(Number(view)))
    )
      return null;
    return {
      viewId: view ? Number(view) : undefined,
      rules: query.rules
        ? decodeRules(JSON.parse(String(query.rules)))
        : undefined,
      display: query.display
        ? activityDisplaySchema.parse(JSON.parse(String(query.display)))
        : undefined,
    };
  } catch {
    return null;
  }
}

export function activityViewQuery(
  state: ActivityViewState,
): Record<string, string> {
  const query: Record<string, string> = {};
  if (state.viewId) query.view = String(state.viewId);
  if (state.rules) query.rules = JSON.stringify(compactRule(state.rules));
  if (state.display) query.display = JSON.stringify(state.display);
  return query;
}

// IDs and inactive values do not affect selection. Compact tuples keep even a
// large nested working copy below ordinary URL/header limits.
function compactRule(node: ActivityFilterNode): unknown[] {
  if (node.kind === "group")
    return [node.join, ...node.children.map(compactRule)];
  return [
    node.field,
    node.operator,
    node.operator === "in" || node.operator === "notIn"
      ? node.values
      : node.value,
    ...(node.operator === "between" ? [node.valueTo] : []),
  ];
}

function decodeRules(value: unknown): ActivityFilterGroup {
  let id = 0;
  function expand(node: unknown, depth: number): unknown {
    if (++id > 100 || depth > 8) throw new Error("Invalid filter size");
    if (!Array.isArray(node)) throw new Error("Invalid filter tuple");
    const nodeId = `n${id}`;
    if (node[0] === "AND" || node[0] === "OR")
      return {
        kind: "group",
        id: nodeId,
        join: node[0],
        children: node
          .slice(1)
          .map((child: unknown) => expand(child, depth + 1)),
      };
    return {
      kind: "condition",
      id: nodeId,
      field: node[0],
      operator: node[1],
      value: typeof node[2] === "string" ? node[2] : "",
      valueTo: node[3] ?? "",
      values: Array.isArray(node[2]) ? node[2] : [],
    };
  }
  return activityRulesSchema.parse(
    Array.isArray(value) ? expand(value, 0) : value,
  );
}

export function activityViewHref(
  path: string,
  state: ActivityViewState,
): string {
  const query = new URLSearchParams(activityViewQuery(state)).toString();
  return query ? `${path}?${query}` : path;
}
