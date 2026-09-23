import { describe, expect, it } from "vitest";

import {
  desktopReferenceFtp,
  desktopWorkoutExecution,
} from "./desktopWorkoutExecution";

const step = (id: string, power: unknown) => ({
  type: "step",
  id,
  durationSeconds: 60,
  power,
  cadence: 90,
  note: "Hold steady",
  intensity: "work",
});

describe("desktop workout execution", () => {
  it("expands repeats and preserves ramp endpoints, cadence and free steps", () => {
    const execution = desktopWorkoutExecution(
      {
        version: 2,
        sport: "bike",
        nodes: [
          {
            type: "repeat",
            id: "repeat",
            reps: 2,
            children: [
              step("ramp", { kind: "ramp", from: 0.5, to: 1 }),
              step("free", { kind: "free" }),
            ],
          },
        ],
      },
      260,
    );
    expect(execution?.segments).toHaveLength(4);
    expect(execution?.segments[0]).toEqual({
      durationSeconds: 60,
      startWatts: 130,
      endWatts: 260,
      cadence: 90,
      note: "Hold steady",
      intensity: "work",
    });
    expect(execution?.segments[1]?.startWatts).toBeNull();
    expect(execution?.segments[2]).toEqual(execution?.segments[0]);
  });
  it("uses current FTP for relative targets and preserves absolute watts", () => {
    const structure = {
      version: 2,
      sport: "bike",
      nodes: [
        step("relative", { kind: "pct", pct: 0.8 }),
        step("absolute", { kind: "watts", from: 100, to: 200 }),
      ],
    };
    expect(
      desktopWorkoutExecution(structure, 300)?.segments.map(
        (s) => s.startWatts,
      ),
    ).toEqual([240, 100]);
    expect(
      desktopWorkoutExecution(structure, 200)?.segments.map((s) => s.endWatts),
    ).toEqual([160, 200]);
    expect(
      desktopReferenceFtp(
        {
          initialValues: { ftp: 200 },
          changes: [
            { id: "a", date: "2026-01-01", ftp: 250 },
            { id: "b", date: "2027-01-01", ftp: 300 },
          ],
        },
        "2026-09-23",
      ),
    ).toBe(250);
  });
  it("refuses malformed or future structures instead of inventing runnable steps", () => {
    expect(desktopWorkoutExecution({ version: 99, nodes: [] }, 250)).toBeNull();
    expect(
      desktopWorkoutExecution(
        {
          version: 2,
          sport: "bike",
          nodes: [step("bad", { kind: "pct", pct: -1 })],
        },
        250,
      ),
    ).toBeNull();
  });
});
