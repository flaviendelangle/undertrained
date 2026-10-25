import { eq, getTableName, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../db";
import * as schema from "../db/schema";
import {
  activities,
  activityStreams,
  athletes,
  desktopCodes,
  desktopSessions,
  plannedTrainings,
} from "../db/schema";
import { eraseAthleteData } from "./athleteErasure";

const ATHLETE_ID = 7;

type Write = {
  verb: "delete" | "update";
  table: unknown;
  where: unknown;
  values?: unknown;
};

/** Every write the erasure issued, in order. */
let writes: Write[] = [];

// Only the transaction hands out a handle that can write, so a statement issued
// outside it fails the test instead of landing outside the rollback.
const tx = {
  delete: (table: unknown) => ({
    where: (where: unknown) => {
      writes.push({ verb: "delete", table, where });
      return Promise.resolve();
    },
  }),
  update: (table: unknown) => ({
    set: (values: unknown) => ({
      where: (where: unknown) => {
        writes.push({ verb: "update", table, where, values });
        return Promise.resolve();
      },
    }),
  }),
};
const db = {
  transaction: (run: (handle: typeof tx) => Promise<unknown>) => run(tx),
} as unknown as Database;

const tables = Object.values(schema).filter((value) => is(value, PgTable));

/**
 * Every table with a foreign key to `athletes.id`, and the column holding it.
 * Walked here independently of the module, so a table added later can't be left
 * out of the erasure without this failing.
 */
const athleteOwned = tables.flatMap((table) =>
  getTableConfig(table).foreignKeys.flatMap((fk) => {
    const { columns, foreignColumns } = fk.reference();
    return foreignColumns[0] === athletes.id
      ? [{ table, column: columns[0] }]
      : [];
  }),
);
const ownedTables = new Set<unknown>(athleteOwned.map(({ table }) => table));

/** Position of the first delete issued against `table`. */
function deleteIndex(table: unknown) {
  return writes.findIndex((op) => op.verb === "delete" && op.table === table);
}

beforeEach(() => {
  writes = [];
});

describe("eraseAthleteData", () => {
  it("deletes every athlete-owned table for only this athlete", async () => {
    // Guards the schema walk itself: an empty list would pass vacuously.
    expect([...ownedTables]).toContain(activities);

    await eraseAthleteData(db, ATHLETE_ID);
    for (const { table, column } of athleteOwned) {
      expect(writes, getTableName(table)).toContainEqual({
        verb: "delete",
        table,
        where: eq(column, ATHLETE_ID),
      });
    }
    expect(
      writes.some((op) => op.verb === "delete" && op.table === athletes),
    ).toBe(false);
  });

  it("deletes a table before the athlete-owned tables it references", async () => {
    const links = tables.flatMap((table) =>
      ownedTables.has(table)
        ? getTableConfig(table).foreignKeys.flatMap((fk) => {
            const { foreignTable } = fk.reference();
            return foreignTable !== table && ownedTables.has(foreignTable)
              ? [{ table, foreignTable }]
              : [];
          })
        : [],
    );
    expect(links).toContainEqual({
      table: plannedTrainings,
      foreignTable: activities,
    });

    await eraseAthleteData(db, ATHLETE_ID);
    for (const { table, foreignTable } of links) {
      expect(
        deleteIndex(table),
        `${getTableName(table)} before ${getTableName(foreignTable)}`,
      ).toBeLessThan(deleteIndex(foreignTable));
    }
  });

  it("revokes pending desktop codes before desktop sessions", async () => {
    await eraseAthleteData(db, ATHLETE_ID);
    expect(deleteIndex(desktopCodes)).toBeGreaterThanOrEqual(0);
    expect(deleteIndex(desktopCodes)).toBeLessThan(
      deleteIndex(desktopSessions),
    );
  });

  it("clears the tokens, calendar feed token, name and link watermark on the kept athlete row", async () => {
    await eraseAthleteData(db, ATHLETE_ID);
    const update = writes.find(
      (op) => op.verb === "update" && op.table === athletes,
    );
    expect(update?.where).toEqual(eq(athletes.id, ATHLETE_ID));
    expect(update?.values).toMatchObject({
      accessToken: "",
      refreshToken: "",
      calendarToken: null,
      name: null,
      lastSeenActivityId: 0,
      lastWebhookSyncAt: null,
    });
  });
});

describe("athlete data without an athlete key", () => {
  it("cascades from the athlete-owned row it hangs off", () => {
    // The erasure deletes only tables keyed on `athletes.id`; anything else
    // reaching into them (streams, best efforts) has to go with its parent, or
    // it would outlive the erasure — or, with no `onDelete`, make it fail.
    const children = tables.flatMap((table) =>
      ownedTables.has(table)
        ? []
        : getTableConfig(table).foreignKeys.flatMap((fk) =>
            ownedTables.has(fk.reference().foreignTable)
              ? [{ table, onDelete: fk.onDelete }]
              : [],
          ),
    );
    expect(children.map(({ table }) => table)).toContain(activityStreams);

    for (const { table, onDelete } of children) {
      expect(onDelete, getTableName(table)).toBe("cascade");
    }
  });
});
