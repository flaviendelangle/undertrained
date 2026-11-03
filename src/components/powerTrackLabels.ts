/** How a caption sits against the point it is pinned to. */
export type LabelAlign = "start" | "center" | "end";

export interface TrackLabelGroup<T> {
  /** The marks this caption labels, in track order. */
  marks: T[];
  /** Where the caption is pinned along the track, from 0 to 1. */
  at: number;
  align: LabelAlign;
}

/**
 * Lays out the power track's labels for one mark, or two (average, then NP).
 * A lone label is centered on its mark, shifted inward near either end of the
 * track so it stays inside the panel. With two marks, average is labelled on
 * its left and NP on its right; near either end, where one of them would have
 * to flip into the other, they share one caption pinned to the outer mark.
 */
export function placeTrackLabels<T extends { at: number }>(
  marks: readonly T[],
): TrackLabelGroup<T>[] {
  if (marks.length === 2) {
    const [average, normalized] = marks;
    if (normalized.at > 0.85) {
      return [
        { marks: [average, normalized], at: normalized.at, align: "end" },
      ];
    }
    if (average.at < 0.15) {
      return [{ marks: [average, normalized], at: average.at, align: "start" }];
    }
    return [
      { marks: [average], at: average.at, align: "end" },
      { marks: [normalized], at: normalized.at, align: "start" },
    ];
  }
  return marks.map((mark) => ({
    marks: [mark],
    at: mark.at,
    align: mark.at < 0.1 ? "start" : mark.at > 0.9 ? "end" : "center",
  }));
}
