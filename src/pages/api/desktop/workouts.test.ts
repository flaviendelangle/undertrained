import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeStep, makeWorkout } from "~/utils/structuredWorkout/fixtures";

import handler from "./workouts";

const mocks = vi.hoisted(() => ({
  athlete: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  select: vi.fn(),
  settings: vi.fn(),
  account: vi.fn(),
}));
vi.mock("~/server/lib/desktopSession", () => ({
  desktopAthlete: mocks.athlete,
}));
vi.mock("~/server/db", () => ({
  db: {
    select: mocks.select,
    query: {
      riderSettings: { findFirst: mocks.settings },
      athletes: { findFirst: mocks.account },
    },
  },
}));

function response() {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(),
    end: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockReturnValue({ from: () => ({ where: mocks.where }) });
  mocks.where.mockReturnValue({ orderBy: mocks.orderBy });
  mocks.orderBy.mockResolvedValue([]);
  mocks.settings.mockResolvedValue(undefined);
  mocks.account.mockResolvedValue({ language: "en-GB" });
});

describe("desktop workout library", () => {
  it("uses authenticated athlete ownership and cycling scope, ignoring query IDs", async () => {
    mocks.athlete.mockResolvedValue({ id: 7, name: "Rider" });
    const res = response();
    await handler(
      {
        method: "GET",
        headers: { authorization: "Bearer token" },
        query: { athleteId: "999" },
      } as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    const query = new PgDialect().sqlToQuery(
      mocks.where.mock.calls[0]?.[0] as SQL,
    );
    expect(query.params).toEqual([7, "bike"]);
    expect(query.sql).toContain('"structured_workouts"."athlete"');
    expect(query.sql).toContain('"structured_workouts"."sport"');
    expect(mocks.athlete).toHaveBeenCalledWith("Bearer token");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        workouts: [],
        builtInWorkouts: expect.arrayContaining([
          expect.objectContaining({ id: "ramp-test" }),
          expect.objectContaining({ id: "ftp-test-20" }),
        ]) as unknown,
      }),
    );
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it.each(["fr-FR", "en-GB"])(
    "uses the requested UI locale %s without changing account settings",
    async (locale) => {
      mocks.athlete.mockResolvedValue({ id: 7, name: "Rider" });
      mocks.account.mockResolvedValue({
        language: locale === "fr-FR" ? "en-GB" : "fr-FR",
      });
      const res = response();
      await handler(
        {
          method: "GET",
          headers: {},
          query: { locale },
        } as unknown as NextApiRequest,
        res as unknown as NextApiResponse,
      );
      const body = res.json.mock.calls[0]?.[0] as {
        builtInWorkouts: { name: string }[];
      };
      expect(body.builtInWorkouts[0]?.name).toBe(
        locale === "fr-FR" ? "Test FTP progressif" : "Ramp test",
      );
    },
  );

  it.each(["de-DE", ["fr-FR", "en-GB"]])(
    "rejects unsupported or repeated locale %s",
    async (locale) => {
      mocks.athlete.mockResolvedValue({ id: 7, name: "Rider" });
      const res = response();
      await handler(
        {
          method: "GET",
          headers: {},
          query: { locale },
        } as unknown as NextApiRequest,
        res as unknown as NextApiResponse,
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mocks.select).not.toHaveBeenCalled();
    },
  );

  it("projects real interval data without leaking the structure or athlete", async () => {
    mocks.athlete.mockResolvedValue({ id: 7, name: "Rider" });
    mocks.orderBy.mockResolvedValue([
      {
        id: 42,
        athlete: 7,
        name: "Tempo",
        description: "Private description",
        sport: "bike",
        durationSeconds: 1800,
        estimatedTss: null,
        ftpAtSave: 250,
        createdAt: 1,
        updatedAt: 2,
        structure: makeWorkout([
          makeStep("s1", 1200, 0.8),
          makeStep("s2", 600, { kind: "free" }),
        ]),
      },
    ]);
    const res = response();
    await handler(
      { method: "GET", headers: {} } as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        workouts: [
          {
            id: 42,
            name: "Tempo",
            durationSeconds: 1800,
            estimatedTss: null,
            execution: {
              referenceFtp: 200,
              ftpTest: null,
              segments: [
                {
                  durationSeconds: 1200,
                  startWatts: 160,
                  endWatts: 160,
                  cadence: null,
                  note: null,
                  intensity: null,
                },
                {
                  durationSeconds: 600,
                  startWatts: null,
                  endWatts: null,
                  cadence: null,
                  note: null,
                  intensity: null,
                },
              ],
            },
            summary: expect.any(String) as unknown,
            profile: [
              [1200, 80],
              [600, null],
            ],
          },
        ],
      }),
    );
  });

  it("rejects unauthenticated sessions before reading workouts", async () => {
    mocks.athlete.mockResolvedValue(null);
    const res = response();
    await handler(
      { method: "GET", headers: {} } as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("rejects %s", async (method) => {
    const res = response();
    await handler(
      { method, headers: {} } as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.status).toHaveBeenCalledWith(405);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.athlete).not.toHaveBeenCalled();
  });
});
