import { expect, it } from "vitest";

import { placeTrackLabels } from "./powerTrackLabels";

const pair = (average: number, normalized: number) => [
  { side: "before" as const, at: average },
  { side: "after" as const, at: normalized },
];

it("labels average and NP on either side of their marks", () => {
  expect(placeTrackLabels(pair(0.4, 0.6))).toEqual([
    {
      labels: [pair(0.4, 0.6)[0]],
      at: 0.4,
      anchor: "-translate-x-full pr-1.5",
    },
    { labels: [pair(0.4, 0.6)[1]], at: 0.6, anchor: "pl-1.5" },
  ]);
});

it("shares one caption pinned to NP when both labels would end at the track's end", () => {
  // Average and NP both past 150% of FTP clamp to the same point.
  const labels = pair(1, 1);
  expect(placeTrackLabels(labels)).toEqual([
    { labels, at: 1, anchor: "-translate-x-full pr-1.5" },
  ]);
});

it("shares one caption pinned to average near the track's start", () => {
  const labels = pair(0.05, 0.1);
  expect(placeTrackLabels(labels)).toEqual([
    { labels, at: 0.05, anchor: "pl-1.5" },
  ]);
});
