import postgres from "postgres";

import type { Locator, Page } from "@playwright/test";

import {
  type ActivityFilterGroup,
  DEFAULT_ACTIVITY_DISPLAY,
} from "../src/utils/activityFilters";
import {
  activityViewHref,
  readActivityViewState,
} from "../src/utils/activityViewState";
import { expect, origin, test } from "./helpers/activityViews";

test.beforeEach(async ({ viewsFixture: f }) => {
  // The timeline is relevant only when history spans a month. Keep the first week
  // unchanged and add a later bucket, leaving empty weeks in between.
  const db = postgres(process.env.DATABASE_URL!);
  try {
    await db`insert into activities (athlete,strava_id,type,name,start_date,start_date_local,distance,total_elevation_gain,average_speed,moving_time,elapsed_time,tss,hrss) values (${f.athleteId},${f.ids.commute + 100},'Ride','Later ride','2026-02-16T09:00:00Z','2026-02-16T09:00:00',10000,100,5,1800,2000,20,20)`;
    await db`update athletes set last_seen_activity_id=(select max(id) from activities where athlete=${f.athleteId}) where id=${f.athleteId}`;
  } finally {
    await db.end();
  }
});

const periodPicker = (page: Page) =>
  page.getByRole("combobox", { name: "Choose a period", exact: true });
const inspector = (page: Page) =>
  page.getByRole("region", {
    name: "Activities behind this period",
    exact: true,
  });
const total = (panel: Locator) => panel.locator("strong");

// The canvas covers the plot only. Clicking the bucket centre also works for an empty stack.
async function clickBucket(
  page: Page,
  index: number,
  count: number,
  touch = false,
) {
  const canvas = page
    .getByRole("group", { name: "Activities Timeline", exact: true })
    .locator("canvas")
    .first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Timeline plot has no bounds");
  const position = {
    x: (box.width * (index + 0.5)) / count,
    y: box.height / 2,
  };
  if (touch) await page.touchscreen.tap(box.x + position.x, box.y + position.y);
  else await page.mouse.click(box.x + position.x, box.y + position.y);
}

async function changeMetric(page: Page, label: string) {
  const card = page
    .getByRole("heading", { name: "Activities Timeline", exact: true })
    .locator("..");
  const options = card.getByRole("button", {
    name: "Display options",
    exact: true,
  });
  const compact = await options.isVisible();
  if (compact) await options.click();
  const controls = compact
    ? page.getByRole("dialog", { name: "Display options", exact: true })
    : card;
  await controls.getByRole("combobox").first().click();
  await page.getByRole("option", { name: label, exact: true }).click();
  if (compact) await page.keyboard.press("Escape");
}

test("desktop inspection intersects a temporary root OR and returns with its chart context", async ({
  page,
  viewsFixture: f,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const db = postgres(process.env.DATABASE_URL!);
  try {
    await db`update activities set start_date_local='2026-02-16T09:00:00' where athlete=${f.athleteId} and strava_id=${f.ids.commute}`;
    // Sunday locally, Monday in UTC: the inspected week and its list must agree.
    await db`update activities set start_date='2026-01-12T07:30:00Z',start_date_local='2026-01-11T22:30:00' where athlete=${f.athleteId} and strava_id=${f.ids.long}`;
  } finally {
    await db.end();
  }
  const saved = await f.client.views.create.mutate({
    athleteId: f.athleteId,
    name: "Working selection",
    folderId: null,
    rules: { kind: "group", id: "saved", join: "AND", children: [] },
    display: DEFAULT_ACTIVITY_DISPLAY,
  });
  const rules: ActivityFilterGroup = {
    kind: "group",
    id: "root",
    join: "OR",
    children: [
      {
        kind: "condition",
        id: "runs",
        field: "sport",
        operator: "in",
        values: ["Run"],
        value: "",
        valueTo: "",
      },
      {
        kind: "group",
        id: "long-rides",
        join: "AND",
        children: [
          {
            kind: "condition",
            id: "rides",
            field: "sport",
            operator: "in",
            values: ["Ride"],
            value: "",
            valueTo: "",
          },
          {
            kind: "condition",
            id: "distance",
            field: "distance",
            operator: "ge",
            values: [],
            value: "40",
            valueTo: "",
          },
        ],
      },
    ],
  };
  await page.goto(
    origin +
      activityViewHref("/activities/charts", { viewId: saved.id, rules }),
  );
  await expect(
    page.getByRole("combobox", { name: "Saved views", exact: true }),
  ).toContainText(saved.name);
  await clickBucket(page, 0, 7);
  const panel = inspector(page);
  await expect(panel).toBeVisible();
  await expect(total(panel)).toHaveText("3h00");
  await expect(panel.getByRole("listitem")).toHaveCount(3);
  await expect(panel.getByText("10 Jan 2026", { exact: true })).toHaveCount(2);
  await expect(panel.getByText("11 Jan 2026", { exact: true })).toHaveCount(1);
  await panel
    .getByRole("link", { name: "100% Alpine_ride", exact: true })
    .hover();
  await expect(page.getByText("100% Alpine_ride", { exact: true })).toHaveCount(
    2,
  );
  await page.mouse.move(500, 50);
  await panel.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(total(panel)).toHaveText("1h00");
  await expect(panel.getByRole("listitem")).toHaveCount(1);
  await changeMetric(page, "Distance (km)");
  await expect(total(panel)).toHaveText("50 km");
  const chartUrl = page.url();
  await panel
    .getByRole("button", { name: "Open in Activities", exact: true })
    .click();
  await expect(page).toHaveURL(/\/activities\?/);
  await expect(
    page.getByRole("link", { name: "Back to chart", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("rowgroup").last().getByRole("row")).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("row").filter({ hasText: "100% Alpine_ride" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "short", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "commute", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("row")
    .filter({ hasText: "100% Alpine_ride" })
    .getByRole("link")
    .click();
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await page.getByRole("link", { name: "Back to chart", exact: true }).click();
  await expect(page).toHaveURL(chartUrl);
  await expect(total(inspector(page))).toHaveText("50 km");
  // Inspection never saves or changes the shared working selection.
  const selection = readActivityViewState(
    Object.fromEntries(new URL(page.url()).searchParams),
  );
  expect(
    (
      await f.client.activities.list.query({
        athleteId: f.athleteId,
        rules: selection!.rules,
      })
    ).activities
      .map((a) => a.stravaId)
      .sort(),
  ).toEqual([f.ids.long, f.ids.race, f.ids.easy, f.ids.commute].sort());
  expect(
    (await f.client.views.list.query({ athleteId: f.athleteId })).find(
      (v) => v.id === saved.id,
    )?.rules.children,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(periodPicker(page)).toBeFocused();
  await periodPicker(page).press("ArrowDown");
  await page.getByRole("option", { name: "W3 2026", exact: true }).click();
  await expect(
    inspector(page).getByText("No matching activities in this period."),
  ).toBeVisible();
  await expect(total(inspector(page))).toHaveText("0 km");
  await inspector(page)
    .getByRole("button", { name: "Previous period", exact: true })
    .click();
  await expect(total(inspector(page))).toHaveText("67 km");
  const header = page
    .getByRole("heading", { name: "Activities Timeline", exact: true })
    .locator("..");
  await header.getByRole("combobox").last().click();
  await page.getByRole("option", { name: "Month", exact: true }).click();
  await expect(inspector(page)).toHaveCount(0);
  await periodPicker(page).click();
  await page.getByRole("option", { name: "Jan 2026", exact: true }).click();
  await expect(total(inspector(page))).toHaveText("67 km");
  await expect(inspector(page).getByRole("listitem")).toHaveCount(3);
  // An expanded app nav and the inspector must still leave the chart controls usable.
  await page.setViewportSize({ width: 768, height: 900 });
  await page.getByRole("button", { name: "Expand menu", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await page
            .getByRole("group", { name: "Activities Timeline", exact: true })
            .boundingBox()
        )?.width,
    )
    .toBeLessThan(250);
  const options = header.getByRole("button", {
    name: "Display options",
    exact: true,
  });
  await expect(options).toBeInViewport();
  const optionsBox = await options.boundingBox();
  const panelBox = await inspector(page).boundingBox();
  expect(optionsBox!.x + optionsBox!.width).toBeLessThanOrEqual(panelBox!.x);
  await options.click();
  await expect(
    page.getByRole("dialog", { name: "Display options", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(total(inspector(page))).toHaveText("67 km");
  await page
    .getByRole("button", { name: "Collapse menu", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("combobox", { name: "Saved views", exact: true })
    .click();
  await page
    .getByRole("option", { name: "All activities", exact: true })
    .click();
  await expect(inspector(page)).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Saved views", exact: true }),
  ).toContainText("All activities");
  expect(
    readActivityViewState(Object.fromEntries(new URL(page.url()).searchParams))
      ?.rules,
  ).toBeUndefined();
});

test("metric contributions follow legend visibility and keep missing load distinct from zero", async ({
  page,
  viewsFixture: f,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const db = postgres(process.env.DATABASE_URL!);
  try {
    await db`update activities set tss=null,hrss=null where athlete=${f.athleteId} and strava_id=${f.ids.short}`;
  } finally {
    await db.end();
  }
  await page.goto(`${origin}/activities/charts`);
  await clickBucket(page, 0, 7);
  const panel = inspector(page);
  await expect(total(panel)).toHaveText("5h00");
  await changeMetric(page, "Load");
  await expect(total(panel)).toHaveText("200");
  await expect(
    panel.getByText(
      "1 activity has no load estimate. It is excluded from the total.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    panel.getByRole("listitem").filter({ hasText: "short" }),
  ).toContainText("Unavailable");
  const chart = page.getByRole("group", {
    name: "Activities Timeline",
    exact: true,
  });
  await chart.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(total(panel)).toHaveText("100");
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await expect(
    panel.getByRole("button", { name: "Ride", exact: true }),
  ).toHaveCount(0);
  await chart.getByRole("button", { name: "Run", exact: true }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Open in Activities", exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole("button", { name: "Show all sports in the chart", exact: true })
    .click();
  await expect(total(panel)).toHaveText("200");
  // Browser Back restores inspection as well as the explicit return links.
  await expect
    .poll(
      () =>
        JSON.parse(new URL(page.url()).searchParams.get("timeline") ?? "{}")
          .hidden,
    )
    .toEqual([]);
  const inspectedUrl = page.url();
  await page
    .getByRole("link", { name: "Activities", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/activities$/);
  await page.goBack();
  await expect(page).toHaveURL(inspectedUrl);
  await expect(total(inspector(page))).toHaveText("200");
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("a chart tap immediately opens the sheet with detail and list return paths", async ({
    page,
    viewsFixture: _f,
  }) => {
    const snapshot = {
      metric: "movingTime",
      precision: "week",
      hidden: [],
      zoom: { start: 0, end: 100 },
    };
    await page.goto(
      `${origin}/activities/charts?timeline=${encodeURIComponent(JSON.stringify(snapshot))}`,
    );
    await clickBucket(page, 0, 7, true);
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(total(sheet)).toHaveText("5h00");
    await expect(sheet.getByRole("listitem")).toHaveCount(5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
    await sheet
      .getByRole("link", { name: "100% Alpine_ride", exact: true })
      .click();
    await page.getByRole("link", { name: "Back", exact: true }).click();
    await expect(total(page.getByRole("dialog"))).toHaveText("5h00");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(periodPicker(page)).toBeFocused();
    await changeMetric(page, "Activities");
    await periodPicker(page).click();
    await page.getByRole("option", { name: "W2 2026", exact: true }).click();
    await expect(total(page.getByRole("dialog"))).toHaveText("5");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Run", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Open in Activities", exact: true })
      .click();
    await expect(page.getByRole("listitem")).toHaveCount(2);
    await page
      .getByRole("link", { name: "Back to chart", exact: true })
      .click();
    await expect(total(page.getByRole("dialog"))).toHaveText("2");
    expect(
      JSON.parse(new URL(page.url()).searchParams.get("timeline")!).zoom,
    ).toEqual({ start: 0, end: 100 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
