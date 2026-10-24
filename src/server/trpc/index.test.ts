import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../db", () => ({ db: {} }));
vi.mock("../../pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));

const { athleteProcedure, router } = await import("./index");

const resolved = vi.fn();

// A refined input, like `timePeriods.create`. tRPC merges the parsed objects,
// so the refinement still runs and `athleteId` still reaches the resolver.
const caller = router({
  create: athleteProcedure
    .input(
      z
        .object({ startDate: z.string(), endDate: z.string() })
        .refine((d) => d.startDate <= d.endDate),
    )
    .mutation(({ input }) => {
      resolved(input);
      return input;
    }),
}).createCaller({
  db: {} as never,
  session: { user: {}, athleteId: 7, expires: "2100-01-01" },
  ip: "127.0.0.1",
});

const period = { startDate: "2026-01-01", endDate: "2026-01-31" };

beforeEach(() => {
  resolved.mockClear();
});

describe("athleteProcedure", () => {
  it("passes the athlete's own id to the resolver with the procedure's fields", async () => {
    expect(await caller.create({ athleteId: 7, ...period })).toEqual({
      athleteId: 7,
      ...period,
    });
  });

  it("still applies the procedure's refinement", async () => {
    await expect(
      caller.create({
        athleteId: 7,
        startDate: "2026-02-01",
        endDate: "2026-01-01",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(resolved).not.toHaveBeenCalled();
  });

  it("rejects another athlete's id before the resolver runs", async () => {
    await expect(
      caller.create({ athleteId: 8, ...period }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "FORBIDDEN" });
    expect(resolved).not.toHaveBeenCalled();
  });

  it("rejects a call without an athleteId", async () => {
    // @ts-expect-error -- the merged input type requires `athleteId`
    await expect(caller.create(period)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(resolved).not.toHaveBeenCalled();
  });
});
