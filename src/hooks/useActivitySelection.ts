import type { ActivityFilterGroup } from "~/utils/activityFilters";

import { useActivityView } from "./useActivityView";

export type ActivityView =
  | "journal"
  | "activities"
  | "heatmap"
  | "statistics"
  | "fitness"
  | "statisticsPowerCurve"
  | "sportPicker"
  | "planMatching"
  | "planTitles";
export interface ActivitySelection {
  activityTypes: string[];
  rules?: ActivityFilterGroup;
  today?: string;
}

const ANALYSIS_VIEWS: readonly ActivityView[] = [
  "activities",
  "heatmap",
  "statistics",
  "statisticsPowerCurve",
];

/** Whether `view` follows the shared activity selection. */
export function isAnalysisView(view: ActivityView): boolean {
  return ANALYSIS_VIEWS.includes(view);
}

/** Analysis shares one selection; planning and athlete context have separate inputs. */
export function useActivitySelection(
  view: ActivityView,
  own: Partial<ActivitySelection> = {},
): ActivitySelection {
  const scope = useActivityView();
  return {
    activityTypes: [],
    ...(isAnalysisView(view) ? { rules: scope.rules, today: scope.today } : {}),
    ...own,
  };
}
