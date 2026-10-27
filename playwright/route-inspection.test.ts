import postgres from "postgres";

import type { Page } from "@playwright/test";

import { expect, origin, test } from "./helpers/activityViews";

const positions = Array.from({ length: 7 }, (_, i) => [
  45 + i * 0.001,
  5 + i * 0.001,
]);
test.beforeEach(async ({ viewsFixture: f }) => {
  const db = postgres(process.env.DATABASE_URL!);
  try {
    const [activity] = await db<
      { id: number }[]
    >`select id from activities where athlete=${f.athleteId} and strava_id=${f.ids.long}`;
    await db`delete from activity_streams where activity_id=${activity.id}`;
    const streams = {
      time: [0, 10, 20, 30, 40, 50, 60],
      distance: [0, 100, 200, 300, 400, 500, 600],
      altitude: [100, 110, 120, 115, 135, 140, 130],
      watts: [0, 100, 200, 300, 0, 400, 500],
      heartrate: [120, 130, 140, 150, 160, 170, 180],
      latlng: positions,
    };
    for (const [type, data] of Object.entries(streams))
      await db`insert into activity_streams (activity_id,type,data,series_type,original_size,resolution) values (${activity.id},${type},${JSON.stringify(data)},'time',7,'high')`;
  } finally {
    await db.end();
  }
});

const explorer = (page: Page) =>
  page.getByRole("region", { name: "Route exploration", exact: true });
const profile = (page: Page) =>
  explorer(page).getByRole("group", { name: "Elevation profile", exact: true });
const section = (page: Page) =>
  explorer(page).getByLabel("Selected section", { exact: true });
const metric = (page: Page, label: string) =>
  section(page)
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: label }) })
    .locator("dd");
async function dragProfile(page: Page, touch = false, release = true) {
  const svg = profile(page);
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  if (!box) throw new Error("No elevation bounds");
  const start = { x: box.x + 42 + (box.width - 60) / 6, y: box.y + 55 };
  const end = { x: box.x + 42 + ((box.width - 60) * 4) / 6, y: start.y };
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [start],
    });
    for (let i = 1; i <= 8; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: start.x + ((end.x - start.x) * i) / 8, y: start.y }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    if (release) await page.mouse.up();
  }
}
async function expectSection(page: Page) {
  await expect(metric(page, "Distance")).toHaveText("0.30 km");
  await expect(metric(page, "Elapsed Time")).toHaveText("0:30");
  await expect(metric(page, "Ascent")).toHaveText("30 m");
  await expect(metric(page, "Avg gradient")).toHaveText("8.3 %");
  await expect(metric(page, "Avg HR")).toHaveText("140 bpm");
  await expect(metric(page, "Avg Power")).toHaveText("200 W");
  const highlight = explorer(page).locator('path[stroke-width="6"]');
  await expect(highlight).toBeVisible();
  const selected = await highlight.boundingBox();
  const route = await explorer(page)
    .locator("path.leaflet-interactive")
    .boundingBox();
  expect(selected!.height).toBeLessThan(route!.height);
}

test("links a profile section, route picking and stream selection while preserving the selected section", async ({
  page,
  viewsFixture: f,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`${origin}/activities/${f.ids.long}`);
  await expect(
    page.getByRole("button", { name: "Expand map", exact: true }),
  ).toBeVisible();
  await expect(profile(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(profile(page)).toBeVisible();
  await dragProfile(page);
  await expectSection(page);
  await page.screenshot({ path: test.info().outputPath("desktop.png") });
  await page.mouse.move(2, 2);
  const selectedBeforeZoom = await explorer(page)
    .locator('path[stroke-width="6"]')
    .boundingBox();
  await explorer(page).getByRole("button", { name: "Zoom to section" }).click();
  await expect
    .poll(
      async () =>
        (await explorer(page).locator('path[stroke-width="6"]').boundingBox())!
          .height,
    )
    .toBeGreaterThan(selectedBeforeZoom!.height);
  await explorer(page)
    .getByRole("button", { name: "Show whole route" })
    .click();
  const route = explorer(page).locator("path.leaflet-interactive");
  const pathBounds = await route.boundingBox();
  if (!pathBounds) throw new Error("No route bounds");
  await route.click({
    position: { x: pathBounds.width / 2, y: pathBounds.height / 2 },
  });
  await page.mouse.move(2, 2);
  await expect(
    explorer(page).getByText("0.30 km · 0:30 · 115 m", { exact: true }),
  ).toBeVisible();
  await profile(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    explorer(page).getByText("0.40 km · 0:40 · 135 m", { exact: true }),
  ).toBeVisible();
  await profile(page).dblclick({ position: { x: 100, y: 55 } });
  await expect(section(page)).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Route exploration" }),
  ).toBeVisible();
  await expect(
    explorer(page).getByText("Drag to select a section", { exact: true }),
  ).toBeVisible();
  await dragProfile(page, false, false);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(section(page)).toHaveCount(0);
  await expect(profile(page)).toBeVisible();
  await dragProfile(page);
  await explorer(page)
    .getByRole("button", { name: "Clear", exact: true })
    .click();
  await expect(section(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Collapse map", exact: true }).click();
  await expect(profile(page)).toHaveCount(0);
  const streams = page
    .getByRole("heading", { name: "Time Series", exact: true })
    .locator("..")
    .locator("..");
  const chart = streams.locator("svg").last();
  const selectStreamRange = async () => {
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    if (!box) throw new Error("No stream bounds");
    await page.mouse.move(box.x + 84 + (box.width - 156) / 6, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(
      box.x + 84 + ((box.width - 156) * 4) / 6,
      box.y + 40,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect(
      streams.getByRole("button", { name: "Reset zoom" }),
    ).toBeVisible();
  };
  for (const reset of ["double-click", "Escape"]) {
    await selectStreamRange();
    if (reset === "double-click")
      await chart.dblclick({ position: { x: 120, y: 40 } });
    else {
      await chart.focus();
      await page.keyboard.press("Escape");
    }
    await expect(section(page)).toHaveCount(0);
    await expect(
      streams.getByRole("button", { name: "Reset zoom" }),
    ).toHaveCount(0);
  }
  await selectStreamRange();
  await streams.getByRole("button", { name: "Distance", exact: true }).click();
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(profile(page)).toBeVisible();
  await expectSection(page);
  await expect(
    page.getByRole("dialog", { name: "Route exploration" }),
  ).toBeVisible();
  await explorer(page).getByRole("button", { name: "Zoom to section" }).click();
  await profile(page).focus();
  await page.keyboard.press("Escape");
  await expect(section(page)).toHaveCount(0);
  await expect(profile(page)).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Route exploration" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(profile(page)).toBeVisible();
  await dragProfile(page);
  await expect(
    explorer(page).getByRole("button", { name: "Zoom to section" }),
  ).toBeVisible();
  await profile(page).focus();
  await page.keyboard.press("Escape");
  // Only Escape outside the focused profile dismisses fullscreen.
  await page.getByRole("button", { name: "Collapse map", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(profile(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Expand map", exact: true }),
  ).toBeFocused();
  await page.goto(`${origin}/activities/${f.ids.short}`);
  await expect(
    page.getByRole("heading", { name: "Time Series", exact: true }),
  ).toBeVisible();
  await expect(explorer(page)).toHaveCount(0);
});

test("supports mobile touch selection and keyboard range handles", async ({
  page,
  viewsFixture: f,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/activities/${f.ids.long}`);
  await expect(
    page.getByRole("button", { name: "Expand map", exact: true }),
  ).toBeVisible();
  await expect(profile(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(profile(page)).toBeVisible();
  await dragProfile(page, true);
  await expectSection(page);
  await page.screenshot({ path: test.info().outputPath("mobile.png") });
  const start = explorer(page).getByRole("slider", { name: "Section start" });
  await start.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(metric(page, "Elapsed Time")).toHaveText("0:40");
  await expect(metric(page, "Avg Power")).toHaveText("150 W");
  await page.keyboard.press("ArrowRight");
  await expectSection(page);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 568 });
  await profile(page).scrollIntoViewIfNeeded();
  const scrollPosition = () =>
    profile(page).evaluate((element) => {
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (
          parent.scrollHeight > parent.clientHeight &&
          getComputedStyle(parent).overflowY === "auto"
        )
          return parent.scrollTop;
      return 0;
    });
  const beforeScroll = await scrollPosition();
  const profileBox = await profile(page).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const touch = {
    x: profileBox!.x + profileBox!.width / 2,
    y: profileBox!.y + 90,
  };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch],
  });
  for (let i = 1; i <= 6; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...touch, y: touch.y - i * 15 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  await expect.poll(scrollPosition).toBeGreaterThan(beforeScroll);
  await expectSection(page);
  const collapse = page.getByRole("button", {
    name: "Collapse map",
    exact: true,
  });
  await collapse.click();
  await expect(profile(page)).toHaveCount(0);
  await expectSection(page);
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(profile(page)).toBeVisible();
  await expectSection(page);
  await explorer(page).getByRole("slider", { name: "Section start" }).focus();
  await page.keyboard.press("Escape");
  await expect(section(page)).toHaveCount(0);
  await expect(profile(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(profile(page)).toBeVisible();
});

test("keeps a flat profile usable without GPS, distance or effort sensors", async ({
  page,
  viewsFixture: f,
}) => {
  const db = postgres(process.env.DATABASE_URL!);
  try {
    const [activity] = await db<
      { id: number }[]
    >`select id from activities where athlete=${f.athleteId} and strava_id=${f.ids.race}`;
    for (const [type, data] of Object.entries({
      time: [0, 10, 20, 30],
      altitude: [100, 100, 100, 100],
      latlng: [],
    }))
      await db`insert into activity_streams (activity_id,type,data,series_type,original_size,resolution) values (${activity.id},${type},${JSON.stringify(data)},'time',4,'high')`;
  } finally {
    await db.end();
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${origin}/activities/${f.ids.race}`);
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(profile(page)).toBeVisible();
  await explorer(page).getByRole("slider", { name: "Section start" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(metric(page, "Elapsed Time")).toHaveText("0:20");
  await expect(metric(page, "Distance")).toHaveText("—");
  await expect(metric(page, "Ascent")).toHaveText("0 m");
  await expect(metric(page, "Avg gradient")).toHaveText("—");
  await expect(section(page).getByText("Avg HR", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    section(page).getByText("Avg Power", { exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath("compact.png") });
});
