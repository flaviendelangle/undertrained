import { useActivityFilter } from "./useActivityFilter";

/** A part of the global activity filter, the one the filter popover edits. */
type GlobalFilterPart =
  "activityTypes" | "workoutTypes" | "timePeriodId" | "hideCommutes";

const WHOLE_FILTER: readonly GlobalFilterPart[] = [
  "activityTypes",
  "workoutTypes",
  "timePeriodId",
  "hideCommutes",
];

/**
 * Which parts of the global activity filter each view honours. This is the one
 * place that decides it: a view names itself to `useActivitySelection` and gets
 * the parts listed here, nothing else.
 */
const GLOBAL_FILTER_BY_VIEW = {
  // The Journal follows the whole filter on purpose, Form and weekly verdicts
  // included.
  journal: WHOLE_FILTER,
  activities: WHOLE_FILTER,
  heatmap: WHOLE_FILTER,
  // The statistics charts share one unfiltered history and pick sports in
  // memory; fitness sums load across every sport.
  statistics: [],
  // A time period's activity table and map show the whole period.
  period: [],
  // The power card. On the statistics page the curve and its year list honour
  // the workout types; they only forward sports and workout types, so honouring
  // more there means sending it too. On a period's page every tab shows the
  // whole period, like its table and map.
  statisticsPowerCurve: ["workoutTypes"],
  periodPowerCurve: [],
  periodPowerZones: [],
  periodPowerDistribution: [],
  // Pickers offer every activity, so the filter can't hide a valid choice.
  sportPicker: [],
  planMatching: [],
} satisfies Record<string, readonly GlobalFilterPart[]>;

export type ActivityView = keyof typeof GLOBAL_FILTER_BY_VIEW;

/** The filter a view sends to any endpoint that selects activities. */
export interface ActivitySelection {
  activityTypes: string[];
  workoutTypes: number[];
  timePeriodId: number | undefined;
  hideCommutes: boolean;
}

/**
 * The activities `view` selects: each part of the global filter it honours,
 * unless `own` sets that part, then `own` for the rest. A part nobody sets
 * doesn't narrow anything.
 */
export function useActivitySelection(
  view: ActivityView,
  own: Partial<ActivitySelection> = {},
): ActivitySelection {
  const filter = useActivityFilter();
  const honoured: readonly GlobalFilterPart[] = GLOBAL_FILTER_BY_VIEW[view];
  const pick = <K extends GlobalFilterPart>(
    part: K,
    none: ActivitySelection[K],
  ): ActivitySelection[K] =>
    own[part] ?? (honoured.includes(part) ? filter[part] : none);

  return {
    activityTypes: pick("activityTypes", []),
    workoutTypes: pick("workoutTypes", []),
    timePeriodId: pick("timePeriodId", undefined),
    hideCommutes: pick("hideCommutes", false),
  };
}
