/**
 * Pure grouping/ordering for the activity-detail "Personal records" card. Kept
 * free of i18n and React so it can be unit-tested; the component layers labels
 * and value formatting on top.
 */

/** Which leaderboard a ranking belongs to — mirrors the server `RankingCategory`. */
export type RankingCategory =
  | "power"
  | "speed"
  | "heartrate"
  | "biggestClimb"
  | "totalElevation"
  | "distance"
  | "duration"
  | "load"
  | "runEffort";

/** One leaderboard placing held by the activity (shape returned by `records.getActivityRankings`). */
export interface ActivityRanking {
  category: RankingCategory;
  paramKey: number | string | null;
  rank: number;
  value: number;
  distance?: number;
}

/** Display groups, in render order. Several categories fold into one group. */
export type RecordGroupKey =
  | "power"
  | "speed"
  | "heartRate"
  | "climbing"
  | "overall"
  | "bestEfforts";

export const RECORD_GROUP_ORDER: RecordGroupKey[] = [
  "power",
  "speed",
  "heartRate",
  "climbing",
  "overall",
  "bestEfforts",
];

const CATEGORY_TO_GROUP: Record<RankingCategory, RecordGroupKey> = {
  power: "power",
  speed: "speed",
  heartrate: "heartRate",
  biggestClimb: "climbing",
  totalElevation: "climbing",
  distance: "overall",
  duration: "overall",
  load: "overall",
  runEffort: "bestEfforts",
};

// Tie-break order within a group when two rankings share a rank, so mixed-metric
// groups (climbing, overall) keep a stable, sensible sequence.
const CATEGORY_ORDER: Record<RankingCategory, number> = {
  power: 0,
  speed: 0,
  heartrate: 0,
  biggestClimb: 0,
  totalElevation: 1,
  distance: 0,
  duration: 1,
  load: 2,
  runEffort: 0,
};

function paramCompare(a: ActivityRanking, b: ActivityRanking): number {
  if (typeof a.paramKey === "number" && typeof b.paramKey === "number") {
    return a.paramKey - b.paramKey;
  }
  if (typeof a.paramKey === "string" && typeof b.paramKey === "string") {
    return a.paramKey.localeCompare(b.paramKey);
  }
  return 0;
}

export interface RecordGroup {
  key: RecordGroupKey;
  rankings: ActivityRanking[];
}

/**
 * Buckets rankings into display groups (in {@link RECORD_GROUP_ORDER}), dropping
 * empty groups. Within each group, the best placing leads (rank asc), then a
 * fixed category order, then the metric parameter ascending.
 */
export function groupActivityRankings(
  rankings: ActivityRanking[],
): RecordGroup[] {
  const byGroup = new Map<RecordGroupKey, ActivityRanking[]>();
  for (const ranking of rankings) {
    const group = CATEGORY_TO_GROUP[ranking.category];
    const existing = byGroup.get(group);
    if (existing) {
      existing.push(ranking);
    } else {
      byGroup.set(group, [ranking]);
    }
  }

  const groups: RecordGroup[] = [];
  for (const key of RECORD_GROUP_ORDER) {
    const arr = byGroup.get(key);
    if (!arr) {
      continue;
    }
    arr.sort(
      (a, b) =>
        a.rank - b.rank ||
        CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
        paramCompare(a, b),
    );
    groups.push({ key, rankings: arr });
  }
  return groups;
}
