import { expect, it } from "vitest";

import { placeTrackLabels } from "./powerTrackLabels";

const average = (at: number) => ({ label: "average", at });
const normalized = (at: number) => ({ label: "NP", at });

it("labels average and NP on either side of their marks", () => {
  const marks = [average(0.4), normalized(0.6)];
  expect(placeTrackLabels(marks)).toEqual([
    { marks: [marks[0]], at: 0.4, align: "end" },
    { marks: [marks[1]], at: 0.6, align: "start" },
  ]);
});

it("shares one caption pinned to NP when both labels would end at the track's end", () => {
  // Average and NP both past 150% of FTP clamp to the same point.
  const marks = [average(1), normalized(1)];
  expect(placeTrackLabels(marks)).toEqual([{ marks, at: 1, align: "end" }]);
});

it("shares one caption pinned to average near the track's start", () => {
  const marks = [average(0.05), normalized(0.1)];
  expect(placeTrackLabels(marks)).toEqual([
    { marks, at: 0.05, align: "start" },
  ]);
});

it("centers a lone label, shifted inward near the ends", () => {
  expect(placeTrackLabels([normalized(0.5)])[0].align).toBe("center");
  expect(placeTrackLabels([normalized(0.05)])[0].align).toBe("start");
  expect(placeTrackLabels([normalized(0.95)])[0].align).toBe("end");
});
