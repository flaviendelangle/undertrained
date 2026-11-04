import postgres from "postgres";

import { expect, origin, test } from "./helpers/activityViews";

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

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`the explorer opens a deep link and picks a leaderboard at ${viewport.width}px`, async ({
    page,
    viewsFixture: f,
  }) => {
    const db = postgres(process.env.DATABASE_URL!);
    try {
      const set = (key: string, bests: Record<number, number>) =>
        db`update activities set power_bests = ${db.json(bests)} where strava_id = ${f.ids[key]}`;
      await set("short", { 60: 900, 300: 150 });
      await set("commute", { 60: 800, 300: 250 });
      await set("long", { 60: 200, 300: 180 });
    } finally {
      await db.end();
    }
    await page.setViewportSize(viewport);
    // Without a link, it opens the first category with records, not the
    // 20 min power that no ride here has.
    await page.goto(`${origin}/personal-bests`);
    await expect(
      viewport.width < 768
        ? page.getByRole("button", { name: /Power · 1 min/ })
        : page.getByRole("combobox", { name: "Record", exact: true }),
    ).toContainText("1 min");
    await page.goto(
      `${origin}/personal-bests?sport=cycling&metric=power&duration=60`,
    );
    const first = page.getByRole("link", { name: "short", exact: true });
    await expect(first).toBeVisible();
    // The activity's local day: it started at 07:30 UTC on 11 Jan.
    await expect(page.getByText("10 Jan 2026").first()).toBeVisible();
    if (viewport.width < 768) {
      await page.getByRole("button", { name: /Power · 1 min/ }).click();
      const drawer = page.getByRole("dialog");
      // Every duration lists its all-time best.
      await expect(
        drawer.getByRole("button", { name: /^5 min/ }),
      ).toContainText("250");
      await drawer.getByRole("button", { name: /^5 min/ }).click();
      await expect(drawer).toHaveCount(0);
    } else {
      await page.getByRole("combobox", { name: "Record", exact: true }).click();
      const option = page.getByRole("option", { name: /^5 min/ });
      await expect(option).toContainText("250");
      await option.click();
    }
    await expect(page).toHaveURL(/duration=300/);
    await expect(
      page.getByRole("link", { name: "commute", exact: true }),
    ).toBeVisible();
    await expect(first).toBeVisible();
    // An activity opened from a row links back to this leaderboard.
    await page.getByRole("link", { name: "commute", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/activities/${f.ids.commute}`));
    expect(decodeURIComponent(page.url())).toContain(
      "/personal-bests?sport=cycling&metric=power&duration=300",
    );
  });
}
