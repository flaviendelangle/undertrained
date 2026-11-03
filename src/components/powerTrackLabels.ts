export interface TrackLabel {
  /** Where the label sits relative to its mark. */
  side: "before" | "center" | "after";
  /** Mark position along the track, from 0 to 1. */
  at: number;
}

export interface TrackLabelGroup<T extends TrackLabel> {
  labels: T[];
  /** Where the group is pinned along the track, from 0 to 1. */
  at: number;
  /** Classes that offset the group from that point. */
  anchor: string;
}

/**
 * Lays out the power track's labels. Each label hugs its mark on its side, but
 * flips inward near either end of the track so it stays inside the panel. A
 * flipped "before"/"after" label would run into its neighbour, so near the ends
 * the pair shares one caption pinned to the outer mark instead.
 */
export function placeTrackLabels<T extends TrackLabel>(
  labels: T[],
): TrackLabelGroup<T>[] {
  const before = labels.find((label) => label.side === "before");
  const after = labels.find((label) => label.side === "after");
  if (before && after) {
    if (after.at > 0.85)
      return [
        {
          labels: [before, after],
          at: after.at,
          anchor: "-translate-x-full pr-1.5",
        },
      ];
    if (before.at < 0.15)
      return [{ labels: [before, after], at: before.at, anchor: "pl-1.5" }];
    return [
      { labels: [before], at: before.at, anchor: "-translate-x-full pr-1.5" },
      { labels: [after], at: after.at, anchor: "pl-1.5" },
    ];
  }
  return labels.map((label) => ({
    labels: [label],
    at: label.at,
    anchor:
      label.at < 0.1
        ? ""
        : label.at > 0.9
          ? "-translate-x-full"
          : "-translate-x-1/2",
  }));
}
