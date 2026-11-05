import postgres from "postgres";

import { EMPTY_ACTIVITY_FILTER } from "../src/utils/activityFilters";
import { readActivityViewState } from "../src/utils/activityViewState";
import { expect, origin, test } from "./helpers/activityViews";

test("optional activity metrics render, sort and persist in saved views", async ({
  page,
  viewsFixture: f,
}) => {
  const db = postgres(process.env.DATABASE_URL!);
  try {
    await db`update activities set average_cadence=83.6, calories=1200.4, perceived_exertion=7.5 where strava_id=${f.ids.long}`;
    await db`update activities set average_cadence=176.4, calories=950.6, perceived_exertion=10 where strava_id=${f.ids.race}`;
    await db`update activities set average_cadence=0, calories=0, perceived_exertion=1 where strava_id=${f.ids.easy}`;
  } finally {
    await db.end();
  }

  await page.goto(`${origin}/activities`);
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  for (const name of ["Cadence", "Calories", "RPE"]) {
    await expect(table.getByRole("columnheader", { name })).toHaveCount(0);
  }

  await page.getByRole("button", { name: "Display", exact: true }).click();
  const dialog = page.getByRole("dialog");
  for (const name of ["Cadence", "Calories", "RPE"]) {
    const checkbox = dialog.getByRole("checkbox", { name, exact: true });
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
  }
  for (const name of [
    "Sport",
    "Date",
    "Distance",
    "Elevation",
    "Moving Time",
    "Pace",
    "Load",
  ]) {
    await dialog.getByRole("checkbox", { name, exact: true }).uncheck();
  }
  await dialog.getByRole("button", { name: "Apply filters" }).click();

  const long = table.getByRole("row").filter({ hasText: "100% Alpine_ride" });
  const race = table.getByRole("row").filter({ hasText: "race" });
  const easy = table.getByRole("row").filter({ hasText: "easy" });
  const missing = table.getByRole("row").filter({ hasText: "short" });
  await expect(long.getByRole("cell")).toHaveText([
    "100% Alpine_ride",
    "84 rpm",
    "1200 kcal",
    "7.5/10",
  ]);
  await expect(race.getByRole("cell")).toHaveText([
    "race",
    "176 spm",
    "951 kcal",
    "10/10",
  ]);
  await expect(easy.getByRole("cell")).toHaveText([
    "easy",
    "0 spm",
    "0 kcal",
    "1/10",
  ]);
  await expect(missing.getByRole("cell")).toHaveText(["short", "", "", ""]);

  for (const [name, highest] of [
    ["Cadence", "race"],
    ["Calories", "100% Alpine_ride"],
    ["RPE", "race"],
  ]) {
    const header = table.getByRole("columnheader", { name });
    const rows = table.locator("tbody tr");
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await expect(rows.first().getByRole("cell").first()).toHaveText(highest);
    await expect(rows.last().getByRole("cell").nth(1)).toHaveText("");
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(rows.first().getByRole("cell").first()).toHaveText("easy");
    await expect(rows.last().getByRole("cell").nth(1)).toHaveText("");
  }

  const state = readActivityViewState(
    Object.fromEntries(new URL(page.url()).searchParams),
  );
  const view = await f.client.views.create.mutate({
    athleteId: f.athleteId,
    name: "Activity metrics",
    folderId: null,
    rules: EMPTY_ACTIVITY_FILTER,
    display: state!.display!,
  });
  await page.goto(`${origin}/activities?view=${view.id}`);
  await expect(long.getByRole("cell").nth(3)).toHaveText("7.5/10");
  await page.reload();
  await expect(
    table.getByRole("columnheader", { name: "RPE" }),
  ).toHaveAttribute("aria-sort", "ascending");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLong = page
    .getByRole("listitem")
    .filter({ hasText: "100% Alpine_ride" });
  await expect(mobileLong).toContainText("84 rpm · 1200 kcal · RPE: 7.5/10");
});
