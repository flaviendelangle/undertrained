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
  workoutTypes: number[];
  hideCommutes: boolean;
  dateFrom?: string;
  dateTo?: string;
  rules?: ActivityFilterGroup;
  today?: string;
}

/** Analysis shares one selection; planning and athlete context have separate inputs. */
export function useActivitySelection(
  view: ActivityView,
  own: Partial<ActivitySelection> = {},
): ActivitySelection {
  const scope = useActivityView();
  const analysis = [
    "activities",
    "heatmap",
    "statistics",
    "statisticsPowerCurve",
  ].includes(view);
  return {
    activityTypes: [],
    workoutTypes: [],
    hideCommutes: false,
    ...(analysis ? { rules: scope.rules, today: scope.today } : {}),
    ...own,
  };
}
