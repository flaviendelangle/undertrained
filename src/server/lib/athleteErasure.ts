import { eq, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import type { PgColumn } from "drizzle-orm/pg-core";

import type { Database } from "../db";
import * as schema from "../db/schema";
import { athletes, desktopCodes, desktopSessions } from "../db/schema";

// ── What the athlete owns ───────────────────────────────────────────────

/**
 * Every column that holds an `athletes.id`, with its table. A foreign key to
 * `athletes.id` is what makes a table athlete data, so a table added to the
 * schema later is erased without a change here. Rows hanging off those tables
 * without an athlete column of their own (streams and best efforts under
 * `activities`) go with them through their `cascade` foreign keys.
 */
const ownerColumns: { table: PgTable; column: PgColumn }[] = Object.values(
  schema,
)
  .filter((value) => is(value, PgTable))
  .flatMap((table) =>
    getTableConfig(table).foreignKeys.flatMap((fk) => {
      const { columns, foreignColumns } = fk.reference();
      return foreignColumns[0] === athletes.id
        ? [{ table, column: columns[0] }]
        : [];
    }),
  );

/**
 * The owner columns in the order their rows are deleted. The first rule is read
 * off the same foreign keys; the second is one the schema can't express.
 *
 * - A table goes before the athlete-owned tables it references (plans before
 *   the activities and workouts they link to). Their `set null` cascades then
 *   have no rows left to rewrite, and a foreign key declared without an
 *   `onDelete` action, which Postgres checks at the end of each statement even
 *   inside a transaction, can't fail the erasure.
 * - Pending desktop codes go before sessions. The transaction doesn't make this
 *   free: each statement reads what other transactions committed before it
 *   started, so a code exchanged after the sessions were deleted would mint a
 *   session that survives. Deleting the codes first locks them, and an exchange
 *   that waits on that lock finds the code gone.
 */
const erasureOrder = (() => {
  const owned = [...new Set(ownerColumns.map(({ table }) => table))];
  /** For each table, the tables that have to be deleted before it. */
  const deletedBefore = new Map(owned.map((table) => [table, [] as PgTable[]]));
  for (const table of owned) {
    for (const fk of getTableConfig(table).foreignKeys) {
      const { foreignTable } = fk.reference();
      if (foreignTable !== table) {
        deletedBefore.get(foreignTable)?.push(table);
      }
    }
  }
  deletedBefore.get(desktopSessions)?.push(desktopCodes);

  const order: PgTable[] = [];
  // Marked on entry, so two tables referencing each other can't recurse forever.
  const visited = new Set<PgTable>();
  const place = (table: PgTable) => {
    if (visited.has(table)) {
      return;
    }
    visited.add(table);
    deletedBefore.get(table)?.forEach(place);
    order.push(table);
  };
  owned.forEach(place);
  return order.flatMap((table) =>
    ownerColumns.filter((owner) => owner.table === table),
  );
})();

// ── Erasure ─────────────────────────────────────────────────────────────

/**
 * Erases everything an athlete owns, in one transaction: what "Delete all my
 * data" and a confirmed Strava deauthorization both run. The athlete row stays
 * for the NextAuth session that references it, so its own foreign-key cascades
 * never fire: this deletes the rows they would have, then clears the tokens and
 * personal fields on the row itself.
 */
export async function eraseAthleteData(
  db: Database,
  athleteId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const { table, column } of erasureOrder) {
      await tx.delete(table).where(eq(column, athleteId));
    }

    // Nulling `calendarToken` takes the iCal feed URL offline; `name` is
    // restored from the Strava profile on the next sign-in. `language` stays as
    // a UI preference, and `stravaAthleteId` is how sign-in finds this row.
    // `lastSeenActivityId` goes back to 0 alongside the activities it indexes: if
    // the athlete ever reconnects, the re-import mints ids above any stale
    // watermark and the link prompt would offer their entire history.
    await tx
      .update(athletes)
      .set({
        accessToken: "",
        refreshToken: "",
        tokenExpiresAt: 0,
        calendarToken: null,
        name: null,
        lastSeenActivityId: 0,
      })
      .where(eq(athletes.id, athleteId));
  });
}
