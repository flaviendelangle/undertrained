import postgres from "postgres";

import { expect, test } from "./helpers/activityViews";

// Runs the command palette's title search against Postgres: the unit test only
// sees the SQL parameters, not which rows LIKE ALL and the title folding keep.
test("activity search matches every folded word, with LIKE wildcards literal", async ({
  viewsFixture: f,
}) => {
  const db = postgres(process.env.DATABASE_URL!);
  try {
    await db`update activities set name = 'Sortie Vélo Électrique' where strava_id = ${f.ids.easy}`;
  } finally {
    await db.end();
  }
  const search = async (query: string) =>
    (await f.client.activities.search.query({ athleteId: f.athleteId, query }))
      .map((activity) => activity.stravaId)
      .sort();

  // "100% Alpine_ride": every word, in any order and any case.
  expect(await search("ALPINE 100%")).toEqual([f.ids.long]);
  // One matching word is not enough.
  expect(await search("alpine sortie")).toEqual([]);
  // Accents fold on both sides.
  expect(await search("velo electrique")).toEqual([f.ids.easy]);
  expect(await search("électrique")).toEqual([f.ids.easy]);
  // `%` and `_` in the query match only themselves.
  expect(await search("alpine_ride")).toEqual([f.ids.long]);
  expect(await search("alpin%ride")).toEqual([]);
  expect(await search("alpine_r_de")).toEqual([]);
  // Another athlete's "Foreign ride" stays out.
  expect(await search("ride")).toEqual([f.ids.long]);
});
