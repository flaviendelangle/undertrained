import { drizzle } from "drizzle-orm/pg-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "../../db/schema";

/** A real drizzle instance over a fake wire; see plannedTrainings.test.ts. */
const statements: { sql: string; params: unknown[] }[] = [];
let replies: unknown[][][];

const db = drizzle(
  async (sql, params) => {
    statements.push({ sql, params });
    return { rows: replies[statements.length - 1] ?? [] };
  },
  { schema },
);

const rescoreAll = vi.fn(() => Promise.resolve());

vi.mock("../../db", () => ({ db }));
vi.mock("../../env", () => ({ env: {} }));
vi.mock("../../lib/sync", () => ({
  activityIngestion: () => ({ rescoreAll }),
}));
vi.mock("../../../pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));

const { riderSettingsRouter } = await import("./riderSettings");

const ATHLETE_ID = 7;

const initialValues = {
  ftp: 250,
  weightKg: 70,
  restingHr: 50,
  maxHr: 190,
  lthr: 170,
  runThresholdPace: null,
  swimThresholdPace: null,
};
const changes = [{ id: "a", date: "2026-03-01", ftp: 260 }];

const saved = {
  athleteId: ATHLETE_ID,
  cdA: 0.3,
  crr: 0.004,
  bikeWeightKg: 8,
  cyclingLoadAlgorithm: "tss" as "tss" | "hrss",
  runningLoadAlgorithm: "rtss" as const,
  swimmingLoadAlgorithm: "stss" as const,
  initialValues,
  changes,
};

/** The stored row, positionally, in the column order of `riderSettings`. */
const existingRow = [
  [1, ATHLETE_ID, 0.3, 0.004, 8, "tss", "rtss", "stss", initialValues, changes],
];

function save(input: Partial<typeof saved>) {
  return riderSettingsRouter
    .createCaller({
      db: db as never,
      session: {
        user: {},
        athleteId: ATHLETE_ID,
        expires: "2100-01-01T00:00:00.000Z",
      },
      ip: "10.0.0.1",
    })
    .save({ ...saved, ...input });
}

beforeEach(() => {
  statements.length = 0;
  replies = [];
  rescoreAll.mockClear();
});

describe("save", () => {
  it("rescores when settings are saved for the first time", async () => {
    await save({});

    expect(statements[1].sql).toContain('insert into "rider_settings"');
    expect(rescoreAll).toHaveBeenCalledWith(ATHLETE_ID);
  });

  it("skips rescoring when only equipment or load algorithms change", async () => {
    replies = [existingRow];

    await save({ cdA: 0.25, bikeWeightKg: 7, cyclingLoadAlgorithm: "hrss" });

    expect(statements[1].sql).toContain('update "rider_settings"');
    expect(rescoreAll).not.toHaveBeenCalled();
  });

  it("rescores when a baseline threshold changes", async () => {
    replies = [existingRow];

    await save({ initialValues: { ...initialValues, ftp: 255 } });

    expect(rescoreAll).toHaveBeenCalledWith(ATHLETE_ID);
  });

  it("rescores when a dated change is edited", async () => {
    replies = [existingRow];

    await save({ changes: [{ ...changes[0], ftp: 265 }] });

    expect(rescoreAll).toHaveBeenCalledWith(ATHLETE_ID);
  });
});
