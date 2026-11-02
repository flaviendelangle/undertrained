import postgres from "postgres";

import { expect, test } from "./helpers/activityViews";

// Runs the command palette's personal bests against Postgres: the unit tests
// start from already-picked winners, not the SQL that ranks them.
test("personal bests keep each key's best activity for the athlete", async ({
  viewsFixture: f,
}) => {
  const db = postgres(process.env.DATABASE_URL!);
  try {
    const set = (key: string, values: Record<string, unknown>) =>
      db`update activities set ${db(values)} where strava_id = ${f.ids[key]}`;
    // 60 s: the run's 1500 W and the other athlete's 2000 W don't count.
    // 7 s isn't a headline duration.
    await set("long", { power_bests: db.json({ 60: 200, 300: 180 }) });
    await set("short", { power_bests: db.json({ 60: 900, 300: 150, 7: 999 }) });
    await set("commute", { power_bests: db.json({ 60: 800, 300: 250 }) });
    await set("race", { power_bests: db.json({ 60: 1500 }) });
    // Speed: lower is better.
    await set("long", { speed_efforts: db.json({ 10000: 1200, 20000: 2600 }) });
    await set("short", {
      speed_efforts: db.json({ 10000: 1100, 20000: 2700, 12345: 1 }),
    });
    await db`update activities set speed_efforts = '{"10000":600}'::jsonb where athlete = ${f.otherId}`;
    const effort = (stravaId: number, name: string, time: number) =>
      db`insert into best_efforts (activity_id,name,distance,elapsed_time,start_date) select id, ${name}, ${name === "5k" ? 5000 : 1000}, ${time}, start_date from activities where strava_id = ${stravaId}`;
    await effort(f.ids.race, "5k", 1300);
    await effort(f.ids.race, "1k", 240);
    await effort(f.ids.easy, "5k", 1250);
    await effort(f.ids.easy, "1k", 250);
    const [foreign] = await db<
      { strava_id: string }[]
    >`select strava_id from activities where athlete = ${f.otherId}`;
    await effort(Number(foreign.strava_id), "5k", 900);
  } finally {
    await db.end();
  }

  const bests = await f.client.records.getPersonalBests.query({
    athleteId: f.athleteId,
  });
  const winners = (
    rows: { key: number | string; stravaId: number; value: number }[],
  ) =>
    rows
      .map(({ key, stravaId, value }) => ({ key, stravaId, value }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));

  expect(
    winners(bests.power.map((best) => ({ ...best, key: best.seconds }))),
  ).toEqual([
    { key: 60, stravaId: f.ids.short, value: 900 },
    { key: 300, stravaId: f.ids.commute, value: 250 },
  ]);
  expect(
    winners(bests.speed.map((best) => ({ ...best, key: best.meters }))),
  ).toEqual([
    { key: 10000, stravaId: f.ids.short, value: 1100 },
    { key: 20000, stravaId: f.ids.long, value: 2600 },
  ]);
  expect(
    winners(bests.runEfforts.map((best) => ({ ...best, key: best.effort }))),
  ).toEqual([
    { key: "1k", stravaId: f.ids.race, value: 240 },
    { key: "5k", stravaId: f.ids.easy, value: 1250 },
  ]);
});
