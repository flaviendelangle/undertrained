import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hash } from "./desktopAuth";
import { desktopAthlete } from "./desktopSession";

const mocks = vi.hoisted(() => ({ select: vi.fn(), where: vi.fn() }));
vi.mock("../db", () => ({ db: { select: mocks.select } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockReturnValue({
    from: () => ({ innerJoin: () => ({ where: mocks.where }) }),
  });
});

describe("desktop session authentication", () => {
  it("requires bearer syntax and a valid token before database access", async () => {
    for (const header of [
      undefined,
      "invalid",
      "a".repeat(43),
      "Basic " + "a".repeat(43),
      "Bearer short",
    ]) {
      expect(await desktopAthlete(header)).toBeNull();
    }
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("checks the token hash and expiry, and rejects missing or expired sessions", async () => {
    mocks.where.mockResolvedValue([]);
    const token = "a".repeat(43);
    expect(await desktopAthlete("Bearer " + token)).toBeNull();
    const query = new PgDialect().sqlToQuery(
      mocks.where.mock.calls[0]?.[0] as SQL,
    );
    expect(query.params[0]).toBe(hash(token));
    expect(query.params[1]).toBeGreaterThan(Math.floor(Date.now() / 1000) - 5);
    expect(query.sql).toContain('"expires_at" >');
    mocks.where.mockResolvedValue([{ id: 7, name: null }]);
    expect(await desktopAthlete("Bearer " + token)).toEqual({
      id: 7,
      name: "Rider",
    });
  });
});
