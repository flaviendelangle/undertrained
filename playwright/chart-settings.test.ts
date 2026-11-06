import postgres from "postgres";

import type { Locator, Page } from "@playwright/test";

import { DEFAULT_ACTIVITY_DISPLAY } from "../src/utils/activityFilters";
import { expect, origin, test } from "./helpers/activityViews";

const header = (page: Page, title: string) =>
  page.getByRole("heading", { name: title, exact: true }).locator("..");
const card = (page: Page, title: string) => header(page, title).locator("..");

async function choose(select: Locator, option: string) {
  await select.click();
  await select
    .page()
    .getByRole("option", { name: option, exact: true })
    .click();
}

function controls(page: Page) {
  const timeline = header(page, "Activities Timeline").getByRole("combobox");
  // The title row and the strip of what the power curve plots under it.
  const power = header(page, "Cycling Power").locator("..");
  return {
    power,
    metric: timeline.first(),
    precision: timeline.last(),
    progress: header(page, "Year-over-Year Progress").getByRole("combobox"),
    zonesSpan: header(page, "Time in Zones").getByRole("combobox", {
      name: "Time span",
    }),
    powerSpan: power.getByRole("combobox", { name: "Time span" }),
    wattsPerKg: power.getByRole("button", { name: "W/kg", exact: true }),
    removeAllTime: power.getByRole("button", {
      name: "Remove All time",
      exact: true,
    }),
  };
}

test("each saved view keeps the chart settings picked for it", async ({
  page,
  viewsFixture: f,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A ride a year earlier shows the timeline and the year-over-year chart. The
  // fixture's activities are all in January, past every rolling time span.
  const db = postgres(process.env.DATABASE_URL!);
  try {
    await db`insert into activities (athlete,strava_id,type,name,start_date,start_date_local,distance,total_elevation_gain,average_speed,moving_time,elapsed_time,tss,hrss) values (${f.athleteId},${f.ids.easy + 100},'Ride','Earlier ride','2025-06-01T09:00:00Z','2025-06-01T09:00:00',10000,100,5,1800,2000,20,20)`;
    await db`update athletes set last_seen_activity_id=(select max(id) from activities where athlete=${f.athleteId}) where id=${f.athleteId}`;
  } finally {
    await db.end();
  }
  const create = (name: string, sports: string[]) =>
    f.client.views.create.mutate({
      athleteId: f.athleteId,
      name,
      folderId: null,
      rules: {
        kind: "group",
        id: "root",
        join: "AND",
        children: sports.length
          ? [
              {
                kind: "condition",
                id: "sport",
                field: "sport",
                operator: "in",
                values: sports,
                value: "",
                valueTo: "",
              },
            ]
          : [],
      },
      display: DEFAULT_ACTIVITY_DISPLAY,
    });
  const rides = await create("Rides", ["Ride"]);
  await create("Everything", []);
  const selectView = (name: string) =>
    choose(
      page.getByRole("combobox", { name: "Saved views", exact: true }),
      name,
    );

  await page.goto(`${origin}/activities/charts?view=${rides.id}`);
  const c = controls(page);
  await choose(c.metric, "Load");
  await choose(c.precision, "Month");
  await choose(c.progress, "Elevation (m)");
  await choose(c.zonesSpan, "Last 7 days");
  await choose(c.powerSpan, "Last 7 days");
  await expect(
    card(page, "Time in Zones").getByText("No data available"),
  ).toBeVisible();
  const noPower = page.getByText(
    "No activities in this selection have power data.",
  );
  await expect(noPower).toBeVisible();
  // A comparison window keeps its own dates within the selection.
  await c.power.getByRole("button", { name: "Compare", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "All time", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(c.removeAllTime).toBeVisible();
  await expect(noPower).toHaveCount(0);
  await c.wattsPerKg.click();

  // Another view starts from the defaults, then keeps its own choice.
  await selectView("Everything");
  await expect(c.metric).toContainText("Moving Time (hour)");
  await expect(c.precision).toContainText("Week");
  await expect(c.progress).toContainText("Distance (km)");
  await expect(c.zonesSpan).toContainText("All time");
  await expect(c.powerSpan).toContainText("All time");
  await expect(c.removeAllTime).toHaveCount(0);
  await expect(c.wattsPerKg).toHaveAttribute("aria-pressed", "false");
  await expect(
    card(page, "Time in Zones").getByText("Unknown", { exact: true }),
  ).toBeVisible();
  await choose(c.metric, "Elapsed Time (hour)");

  const expectRides = async () => {
    await expect(c.metric).toContainText("Load");
    await expect(c.precision).toContainText("Month");
    await expect(c.progress).toContainText("Elevation (m)");
    await expect(c.zonesSpan).toContainText("Last 7 days");
    await expect(c.powerSpan).toContainText("Last 7 days");
    await expect(c.removeAllTime).toBeVisible();
    await expect(c.wattsPerKg).toHaveAttribute("aria-pressed", "true");
  };
  await selectView("Rides");
  await expectRides();
  await page.reload();
  await expectRides();
  await selectView("Everything");
  await expect(c.metric).toContainText("Elapsed Time (hour)");
  await expect(c.zonesSpan).toContainText("All time");
});
