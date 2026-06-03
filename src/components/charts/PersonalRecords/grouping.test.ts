import { describe, expect, it } from "vitest";

import {
  type ActivityRanking,
  RECORD_GROUP_ORDER,
  groupActivityRankings,
} from "./grouping";

const r = (
  category: ActivityRanking["category"],
  rank: number,
  paramKey: ActivityRanking["paramKey"] = null,
): ActivityRanking => ({ category, rank, paramKey, value: 0 });

describe("groupActivityRankings", () => {
  it("returns groups in the fixed render order, skipping empty ones", () => {
    const groups = groupActivityRankings([
      r("runEffort", 2, "10K"),
      r("power", 1, 1200),
      r("distance", 3),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["power", "overall", "bestEfforts"]);
    // Never invents an empty group.
    expect(groups.every((g) => g.rankings.length > 0)).toBe(true);
  });

  it("folds elevation categories into one 'climbing' group", () => {
    const groups = groupActivityRankings([
      r("totalElevation", 5),
      r("biggestClimb", 2),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("climbing");
    // Best rank first, then the fixed category order (climb before total).
    expect(groups[0].rankings.map((x) => x.category)).toEqual([
      "biggestClimb",
      "totalElevation",
    ]);
  });

  it("sorts within a group by rank, then param ascending", () => {
    const groups = groupActivityRankings([
      r("power", 4, 60),
      r("power", 1, 1200),
      r("power", 1, 300),
    ]);
    expect(groups[0].rankings.map((x) => [x.rank, x.paramKey])).toEqual([
      [1, 300],
      [1, 1200],
      [4, 60],
    ]);
  });

  it("orders the 'overall' group distance → duration → load on ties", () => {
    const groups = groupActivityRankings([
      r("load", 1),
      r("duration", 1),
      r("distance", 1),
    ]);
    expect(groups[0].rankings.map((x) => x.category)).toEqual([
      "distance",
      "duration",
      "load",
    ]);
  });

  it("every category maps to a known render group", () => {
    const all: ActivityRanking["category"][] = [
      "power",
      "speed",
      "heartrate",
      "biggestClimb",
      "totalElevation",
      "distance",
      "duration",
      "load",
      "runEffort",
    ];
    const groups = groupActivityRankings(all.map((c) => r(c, 1)));
    expect(groups.every((g) => RECORD_GROUP_ORDER.includes(g.key))).toBe(true);
  });
});
