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
  page.getByRole("region", {
    name: "Route exploration",
    exact: true,
    includeHidden: true,
  });
const profile = (page: Page) =>
  explorer(page).getByRole("group", {
    name: "Elevation profile",
    exact: true,
    includeHidden: true,
  });
const details = (page: Page) =>
  page.getByRole("dialog", { name: "Segment", exact: true });
const card = (page: Page) =>
  page.getByRole("region", { name: "Segment", exact: true });
const segment = (page: Page) => card(page).or(details(page));
const metric = (page: Page, label: string) =>
  details(page)
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: label }) })
    .locator("dd");

async function expectCompactMap(page: Page) {
  await expect(
    page.getByRole("button", { name: "Expand map", exact: true }),
  ).toBeVisible();
  await expect(profile(page)).toHaveCount(0);
  await expect(segment(page)).toHaveCount(0);
  await expect(explorer(page).locator('path[stroke-width="6"]')).toHaveCount(0);
  await expect(
    explorer(page).getByRole("button", { name: /^Segment (start|end)$/ }),
  ).toHaveCount(0);
  await expect(
    explorer(page).getByRole("button", {
      name: "Zoom to segment",
      exact: true,
    }),
  ).toHaveCount(0);
}
async function touchDrag(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  beforeRelease?: () => Promise<void>,
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  for (let i = 1; i <= 8 && (start.x !== end.x || start.y !== end.y); i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + ((end.x - start.x) * i) / 8,
          y: start.y + ((end.y - start.y) * i) / 8,
        },
      ],
    });
  await beforeRelease?.();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}
async function dragProfile(page: Page, touch = false, release = true) {
  const svg = profile(page);
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  if (!box) throw new Error("No elevation bounds");
  const start = { x: box.x + 42 + (box.width - 60) / 6, y: box.y + 55 };
  const end = { x: box.x + 42 + ((box.width - 60) * 4) / 6, y: start.y };
  if (touch) {
    await touchDrag(page, start, end);
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    if (release) await page.mouse.up();
  }
}
async function expectSegment(page: Page) {
  for (const [label, value] of [
    ["Distance", "0.30 km"],
    ["Elapsed Time", "0:30"],
  ]) {
    await expect(
      segment(page)
        .locator("dl > div")
        .filter({ has: page.locator("dt", { hasText: label }) })
        .locator("dd"),
    ).toHaveText(value);
  }
  const highlight = explorer(page).locator('path[stroke-width="6"]');
  await expect(highlight).toBeVisible();
  const selected = await highlight.boundingBox();
  const route = await explorer(page)
    .locator("path.leaflet-interactive")
    .boundingBox();
  expect(selected!.height).toBeLessThan(route!.height);
}
async function waitForDrawer(page: Page) {
  await expect
    .poll(async () => {
      const box = await details(page).boundingBox();
      return box
        ? Math.max(
            box.x + box.width - page.viewportSize()!.width,
            box.y + box.height - page.viewportSize()!.height,
          )
        : Infinity;
    })
    .toBeLessThanOrEqual(1);
  await details(page).evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
}
async function expectDetails(page: Page) {
  await waitForDrawer(page);
  await expect(metric(page, "Distance")).toHaveText("0.30 km");
  await expect(metric(page, "Elapsed Time")).toHaveText("0:30");
  await expect(metric(page, "Ascent")).toHaveText("30 m");
  await expect(metric(page, "Avg gradient")).toHaveText("8.3 %");
  await expect(metric(page, "Avg HR")).toHaveText("140 bpm");
  await expect(metric(page, "Avg Power")).toHaveText("200 W");
  const chart = details(page).getByRole("img", {
    name: "Segment elevation profile",
    exact: true,
  });
  await expect(chart).toBeVisible();
  const colors = await chart
    .locator("rect[fill]")
    .evaluateAll((elements) => [
      ...new Set(elements.map((element) => element.getAttribute("fill"))),
    ]);
  expect(colors.length).toBeGreaterThan(1);
  await expect(
    details(page).getByRole("list", { name: "Gradient legend" }),
  ).toBeVisible();
}

async function seedClimbs(
  athleteId: number,
  stravaId: number,
  routeDistance = 12_000,
) {
  const distance = Array.from(
    { length: routeDistance / 100 + 1 },
    (_, i) => i * 100,
  );
  const altitude = distance.map((d) =>
    d <= 1000
      ? 100
      : d <= 5000
        ? 100 + (d - 1000) * 0.06
        : d <= 6500
          ? 340 - (d - 5000) * 0.08
          : d <= 10500
            ? 220 + (d - 6500) * 0.06
            : 460,
  );
  const streams = {
    time: distance.map((_, i) => i * 20),
    distance,
    altitude,
    latlng: distance.map((_, i) => [45 + i * 0.001, 5 + i * 0.001]),
    watts: distance.map(() => 200),
    heartrate: distance.map(() => 150),
  };
  const db = postgres(process.env.DATABASE_URL!);
  try {
    for (const [type, data] of Object.entries(streams))
      await db`update activity_streams set data=${JSON.stringify(data)},original_size=${data.length} where type=${type} and activity_id=(select id from activities where athlete=${athleteId} and strava_id=${stravaId})`;
  } finally {
    await db.end();
  }
}

test("selects detected climbs from the profile or keyboard without preventing manual segment selection", async ({
  page,
  viewsFixture: f,
}) => {
  await seedClimbs(f.athleteId, f.ids.long);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`${origin}/activities/${f.ids.long}`);
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  const climbs = profile(page).getByRole("button", { name: /^Climb / });
  await expect(climbs).toHaveCount(2);
  await expect(climbs.first()).toHaveAccessibleName(/^Climb 1, Cat\. 3,/);
  await expect(climbs.last()).toHaveAccessibleName(/^Climb 2, Cat\. 3,/);
  const svg = profile(page);
  const box = (await svg.boundingBox())!;
  await svg.click({
    position: { x: 42 + ((box.width - 60) * 3000) / 12000, y: 60 },
  });
  await expect(details(page)).toBeVisible();
  await waitForDrawer(page);
  await expect(metric(page, "Distance")).toHaveText("4.00 km");
  await expect(
    explorer(page).getByRole("region", {
      name: "Segment",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("climbs-desktop.png") });
  await details(page)
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(details(page)).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  const start = explorer(page).getByRole("slider", { name: "Segment start" });
  const end = explorer(page).getByRole("slider", { name: "Segment end" });
  await expect(start).toHaveAttribute("aria-valuenow", "1000");
  await expect(end).toHaveAttribute("aria-valuenow", "5000");
  await expect(climbs.first()).toHaveAttribute("aria-pressed", "true");
  // Enter on another climb must not recommit the existing segment in the profile's capture handler.
  await climbs.last().focus();
  await page.keyboard.press("Enter");
  await expect(details(page)).toBeVisible();
  await expect(
    details(page).getByText("21:40 – 35:00", { exact: true }),
  ).toBeVisible();
  await expect(details(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(details(page)).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  await expect(start).toHaveAttribute("aria-valuenow", "6500");
  await expect(end).toHaveAttribute("aria-valuenow", "10500");
  await expect(climbs.last()).toHaveAttribute("aria-pressed", "true");
  // Selecting the same climb again must reopen its drawer.
  await climbs.last().focus();
  await page.keyboard.press("Space");
  await expect(details(page)).toBeVisible();
  await details(page)
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(details(page)).toHaveCount(0);
  await dragProfile(page);
  await expect(card(page)).toBeVisible();
  await expect(details(page)).toHaveCount(0);
  await expect(start).toHaveAttribute("aria-valuenow", "2000");
  await expect(end).toHaveAttribute("aria-valuenow", "8000");
  await expect(climbs.first()).toHaveAttribute("aria-pressed", "false");
  await expect(climbs.last()).toHaveAttribute("aria-pressed", "false");
  await card(page)
    .getByRole("button", { name: "Details", exact: true })
    .click();
  await expect(metric(page, "Distance")).toHaveText("6.00 km");
  await details(page)
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(details(page)).toHaveCount(0);
  await expect(card(page)).toBeVisible();
  await svg.focus();
  await page.keyboard.press("Escape");
  await expect(segment(page)).toHaveCount(0);
  await expect(climbs).toHaveCount(2);
  await expect(svg).toBeVisible();
});

async function routePoint(page: Page, index: number) {
  return explorer(page)
    .locator("path.leaflet-interactive")
    .evaluate((element, index) => {
      const path = element as SVGPathElement;
      // The fixture's seven samples lie on a straight route, in recording order.
      const point = path.getPointAtLength((path.getTotalLength() * index) / 6);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(
        path.getScreenCTM()!,
      );
      return { x: screen.x, y: screen.y };
    }, index);
}

test("resizes either map endpoint to the nearest route sample, including crossing and cancelled drags", async ({
  page,
  viewsFixture: f,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`${origin}/activities/${f.ids.long}`);
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await dragProfile(page);
  const mapBox = (await explorer(page)
    .locator(".leaflet-container")
    .boundingBox())!;
  await page.mouse.move(mapBox.x + 60, mapBox.y + 60);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + 90, mapBox.y + 75, { steps: 8 });
  await page.mouse.up();
  const pannedRoute = (await explorer(page)
    .locator("path.leaflet-interactive")
    .boundingBox())!;
  const handle = (boundary: string) =>
    explorer(page).getByRole("button", {
      name: `Segment ${boundary}`,
      exact: true,
    });
  const moveHandle = async (
    boundary: string,
    index: number,
    release = true,
  ) => {
    const box = (await handle(boundary).boundingBox())!;
    const target = await routePoint(page, index);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Deliberately leave the route. The endpoint still snaps to its nearest sample.
    await page.mouse.move(target.x + 24, target.y + 24, { steps: 8 });
    if (release) await page.mouse.up();
  };
  const duration = card(page)
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: "Elapsed Time" }) })
    .locator("dd");
  const start = explorer(page).getByRole("slider", { name: "Segment start" });
  const end = explorer(page).getByRole("slider", { name: "Segment end" });
  await moveHandle("end", 6);
  await expect(duration).toHaveText("0:50");
  expect(
    (await explorer(page).locator("path.leaflet-interactive").boundingBox())!.x,
  ).toBeCloseTo(pannedRoute.x, -1);
  await expect(end).toHaveAttribute("aria-valuenow", "600");
  await moveHandle("start", 2);
  await expect(duration).toHaveText("0:40");
  await expect(start).toHaveAttribute("aria-valuenow", "200");
  await moveHandle("start", 4, false);
  await expect(duration).toHaveText("0:20");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(duration).toHaveText("0:40");
  await expect(profile(page)).toBeVisible();
  // Cross the other endpoint without losing pointer capture or swapping the moving handle.
  await moveHandle("end", 1);
  await expect(duration).toHaveText("0:10");
  await expect(start).toHaveAttribute("aria-valuenow", "100");
  await expect(end).toHaveAttribute("aria-valuenow", "200");
  await moveHandle("end", 5);
  await explorer(page)
    .getByRole("button", { name: "Zoom to segment", exact: true })
    .click();
  const route = explorer(page).locator("path.leaflet-interactive");
  const before = (await route.boundingBox())!;
  const a = (await handle("start").boundingBox())!;
  const b = (await handle("end").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2 + 20, (a.y + b.y) / 2 + 20, {
    steps: 8,
  });
  await expect(duration).toHaveText("0:20");
  const during = (await route.boundingBox())!;
  expect(during.x).toBeCloseTo(before.x, 0);
  expect(during.y).toBeCloseTo(before.y, 0);
  expect(during.width).toBeCloseTo(before.width, 0);
  await page.mouse.up();
  await expect(end).toHaveAttribute("aria-valuenow", "300");
  // Releasing on the other endpoint clears the empty segment, then map panning works again.
  await explorer(page)
    .getByRole("button", { name: "Show whole route", exact: true })
    .click();
  const anchor = (await handle("start").boundingBox())!;
  const edge = (await handle("end").boundingBox())!;
  await page.mouse.move(edge.x + 20, edge.y + 20);
  await page.mouse.down();
  await page.mouse.move(anchor.x + 20, anchor.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect(segment(page)).toHaveCount(0);
  const map = (await explorer(page)
    .locator(".leaflet-container")
    .boundingBox())!;
  const original = (await route.boundingBox())!;
  await page.mouse.move(map.x + 50, map.y + 50);
  await page.mouse.down();
  await page.mouse.move(map.x + 100, map.y + 80, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await route.boundingBox())!.x - original.x)
    .toBeGreaterThan(40);
});

test("map endpoint drags keep the other boundary of a stream selection between samples", async ({
  page,
  viewsFixture: f,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`${origin}/activities/${f.ids.long}`);
  const streams = page
    .getByRole("heading", { name: "Time Series", exact: true })
    .locator("..")
    .locator("..");
  const chart = streams.locator("svg").last();
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  // Samples are 10 s apart. Select 0:11 – 0:39 so neither boundary is a sample.
  const at = (time: number) => box.x + 84 + ((box.width - 156) * time) / 60;
  await page.mouse.move(at(11), box.y + 40);
  await page.mouse.down();
  await page.mouse.move(at(39), box.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  const duration = card(page)
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: "Elapsed Time" }) })
    .locator("dd");
  const selected = await duration.textContent();
  expect(selected).not.toMatch(/0$/);
  const handle = explorer(page).getByRole("button", {
    name: "Segment end",
    exact: true,
  });
  const handleBox = (await handle.boundingBox())!;
  const target = await routePoint(page, 5);
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await expect(duration).not.toHaveText(selected!);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(duration).toHaveText(selected!);
  // Resizing the end keeps the start at 0:11 instead of snapping it to 0:10.
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await expect(duration).toHaveText("0:39");
});

test("End moves a map endpoint to the last recorded GPS point", async ({
  page,
  viewsFixture: f,
}) => {
  const db = postgres(process.env.DATABASE_URL!);
  try {
    await db`update activity_streams set data=jsonb_set(data::jsonb,'{6}','null')::text where type='latlng' and activity_id=(select id from activities where athlete=${f.athleteId} and strava_id=${f.ids.long})`;
  } finally {
    await db.end();
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`${origin}/activities/${f.ids.long}`);
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await dragProfile(page);
  const end = explorer(page).getByRole("slider", { name: "Segment end" });
  await expect(end).toHaveAttribute("aria-valuenow", "400");
  await explorer(page)
    .getByRole("button", { name: "Segment end", exact: true })
    .focus();
  await page.keyboard.press("End");
  await expect(end).toHaveAttribute("aria-valuenow", "500");
});

test("detects climbs around a missing distance sample", async ({
  page,
  viewsFixture: f,
}) => {
  await seedClimbs(f.athleteId, f.ids.long);
  const db = postgres(process.env.DATABASE_URL!);
  try {
    // A single gap in the flat start disables the distance axis, not climb detection.
    await db`update activity_streams set data=jsonb_set(data::jsonb,'{5}','null')::text where type='distance' and activity_id=(select id from activities where athlete=${f.athleteId} and strava_id=${f.ids.long})`;
  } finally {
    await db.end();
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`${origin}/activities/${f.ids.long}`);
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(
    profile(page).getByRole("button", { name: /^Climb / }),
  ).toHaveCount(2);
});

test("links fullscreen segment inspection to stream selection and clears it on exit", async ({
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
  const mapBefore = await explorer(page)
    .locator(".leaflet-container")
    .boundingBox();
  const profileBefore = await profile(page).boundingBox();
  await dragProfile(page);
  await expectSegment(page);
  const mapAfter = await explorer(page)
    .locator(".leaflet-container")
    .boundingBox();
  const profileAfter = await profile(page).boundingBox();
  const cardBox = await segment(page).boundingBox();
  expect(mapAfter!.height).toBeCloseTo(mapBefore!.height, 0);
  expect(profileAfter!.y).toBeCloseTo(profileBefore!.y, 0);
  expect(cardBox!.x).toBeGreaterThan(mapAfter!.x);
  expect(cardBox!.x + cardBox!.width).toBeLessThan(
    mapAfter!.x + mapAfter!.width,
  );
  expect(cardBox!.y).toBeGreaterThan(mapAfter!.y + mapAfter!.height / 2);
  expect(cardBox!.y + cardBox!.height).toBeLessThan(
    mapAfter!.y + mapAfter!.height,
  );
  await expect(card(page).locator("dt")).toHaveCount(2);
  await expect(card(page).getByRole("heading")).toHaveCount(0);
  await expect(
    card(page).getByText("0:10 – 0:40", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("desktop.png") });
  await card(page)
    .getByRole("button", { name: "Details", exact: true })
    .click();
  await expectDetails(page);
  await page.screenshot({
    path: test.info().outputPath("desktop-details.png"),
  });
  await details(page)
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(details(page)).toHaveCount(0);
  await expectSegment(page);
  await expect(
    card(page).getByRole("button", { name: "Details", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Collapse map", exact: true }).click();
  await expectCompactMap(page);
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(profile(page)).toBeVisible();
  await expect(segment(page)).toHaveCount(0);
  await dragProfile(page);
  await expectSegment(page);
  await page.mouse.move(2, 2);
  const selectedBeforeZoom = await explorer(page)
    .locator('path[stroke-width="6"]')
    .boundingBox();
  await explorer(page).getByRole("button", { name: "Zoom to segment" }).click();
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
  await expect(segment(page)).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Route exploration" }),
  ).toBeVisible();
  await expect(
    explorer(page).getByText("Drag to select a segment", { exact: true }),
  ).toBeVisible();
  await dragProfile(page, false, false);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(segment(page)).toHaveCount(0);
  await expect(profile(page)).toBeVisible();
  await dragProfile(page);
  await profile(page).focus();
  await page.keyboard.press("Escape");
  await expect(segment(page)).toHaveCount(0);
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
    await expectCompactMap(page);
  };
  for (const reset of ["double-click", "Escape"]) {
    await selectStreamRange();
    if (reset === "double-click")
      await chart.dblclick({ position: { x: 120, y: 40 } });
    else {
      await chart.focus();
      await page.keyboard.press("Escape");
    }
    await expect(segment(page)).toHaveCount(0);
    await expect(
      streams.getByRole("button", { name: "Reset zoom" }),
    ).toHaveCount(0);
  }
  await selectStreamRange();
  await streams.getByRole("button", { name: "Distance", exact: true }).click();
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(profile(page)).toBeVisible();
  await expectSegment(page);
  await expect(
    page.getByRole("dialog", { name: "Route exploration" }),
  ).toBeVisible();
  await explorer(page).getByRole("button", { name: "Zoom to segment" }).click();
  await profile(page).focus();
  await page.keyboard.press("Escape");
  await expect(segment(page)).toHaveCount(0);
  await expect(profile(page)).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Route exploration" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(profile(page)).toBeVisible();
  await dragProfile(page);
  await expect(
    explorer(page).getByRole("button", { name: "Zoom to segment" }),
  ).toBeVisible();
  // Only Escape outside the focused profile dismisses fullscreen.
  await page.getByRole("button", { name: "Collapse map", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(profile(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Expand map", exact: true }),
  ).toBeFocused();
  await expectCompactMap(page);
  await page.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(profile(page)).toBeVisible();
  await expect(segment(page)).toHaveCount(0);
  await expect(
    explorer(page).getByRole("slider", { name: "Segment start" }),
  ).toHaveAttribute("aria-valuenow", "0");
  await expect(
    explorer(page).getByRole("slider", { name: "Segment end" }),
  ).toHaveAttribute("aria-valuenow", "600");
  await page.getByRole("button", { name: "Collapse map", exact: true }).click();
  await page.goto(`${origin}/activities/${f.ids.short}`);
  await expect(
    page.getByRole("heading", { name: "Time Series", exact: true }),
  ).toBeVisible();
  await expect(explorer(page)).toHaveCount(0);
});

test.describe("mobile", () => {
  test.use({ hasTouch: true });

  test("a profile tap selects a detected climb and immediately opens its segment drawer", async ({
    page,
    viewsFixture: f,
  }) => {
    await seedClimbs(f.athleteId, f.ids.long, 120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/activities/${f.ids.long}`);
    await page.getByRole("button", { name: "Expand map", exact: true }).click();
    const svg = profile(page);
    await expect(svg).toBeVisible();
    await expect(svg.getByText("C3", { exact: true })).toHaveCount(2);
    await expect(svg.getByText("C3", { exact: true }).first()).toBeVisible();
    await expect(svg.getByText("C3", { exact: true }).last()).toBeVisible();
    const box = (await svg.boundingBox())!;
    await svg.tap({
      position: { x: 42 + ((box.width - 60) * 3000) / 120000, y: 60 },
    });
    await expect(metric(page, "Distance")).toHaveText("4.00 km");
    await expect(metric(page, "Elapsed Time")).toHaveText("13:20");
    await waitForDrawer(page);
    await page.screenshot({
      path: test.info().outputPath("climbs-mobile.png"),
    });
    await details(page)
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(segment(page)).toHaveCount(0);
    await expect(svg).toBeVisible();
    const climbs = profile(page).getByRole("button", { name: /^Climb / });
    await climbs.last().tap();
    await expect(metric(page, "Distance")).toHaveText("4.00 km");
    await expect(
      details(page).getByText("21:40 – 35:00", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  });

  test("mobile segment drawers reset selection on close, Escape and swipe without closing fullscreen", async ({
    page,
    viewsFixture: f,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/activities/${f.ids.long}`);
    await page.getByRole("button", { name: "Expand map", exact: true }).click();
    await expect(profile(page)).toBeVisible();
    const before = await explorer(page)
      .locator(".leaflet-container")
      .boundingBox();
    const drawer = page.getByRole("dialog", {
      name: "Segment",
      exact: true,
    });
    await dragProfile(page, true);
    await expect(drawer).toBeVisible();
    await expectSegment(page);
    await expectDetails(page);
    const after = await explorer(page)
      .locator(".leaflet-container")
      .boundingBox();
    expect(after!.height).toBeCloseTo(before!.height, 0);
    await page.screenshot({ path: test.info().outputPath("mobile.png") });
    await drawer.getByRole("button", { name: "Close", exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await expect(segment(page)).toHaveCount(0);
    await expect(explorer(page).locator('path[stroke-width="6"]')).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("dialog", { name: "Route exploration", exact: true }),
    ).toBeVisible();

    const start = explorer(page).getByRole("slider", { name: "Segment start" });
    const thumb = await start.evaluate((element) => {
      const rect = element.parentElement!.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    const sliderWidth = (await profile(page).boundingBox())!.width - 60;
    await touchDrag(
      page,
      thumb,
      { x: thumb.x + sliderWidth / 6, y: thumb.y },
      async () => {
        await expect(start).toHaveAttribute("aria-valuenow", "100");
        await expect(drawer).toHaveCount(0);
      },
    );
    await expect(drawer).toBeVisible();
    await expect(metric(page, "Elapsed Time")).toHaveText("0:50");
    await waitForDrawer(page);
    await page
      .locator('[data-slot="drawer-overlay"]')
      .tap({ position: { x: 100, y: 100 } });
    await expect(drawer).toHaveCount(0);
    await expect(segment(page)).toHaveCount(0);

    // Keyboard adjustments remain editable until Enter opens the drawer.
    await start.focus();
    await page.keyboard.press("ArrowRight");
    await expect(drawer).toHaveCount(0);
    const end = explorer(page).getByRole("slider", { name: "Segment end" });
    await end.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(drawer).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(drawer).toBeVisible();
    await expectSegment(page);
    await expectDetails(page);
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(segment(page)).toHaveCount(0);
    await expect(profile(page)).toBeVisible();
    await profile(page).focus();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Route exploration", exact: true }),
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 568 });
    await dragProfile(page, true);
    await expect(drawer).toBeVisible();
    await waitForDrawer(page);
    const box = await drawer.boundingBox();
    const touch = { x: box!.x + box!.width / 2, y: box!.y + 18 };
    await touchDrag(page, touch, { x: touch.x, y: 566 });
    await expect(drawer).toHaveCount(0);
    await expect(segment(page)).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Route exploration", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Collapse map", exact: true })
      .click();
    const streams = page
      .getByRole("heading", { name: "Time Series", exact: true })
      .locator("../..");
    const chart = streams.locator("svg").last();
    await chart.scrollIntoViewIfNeeded();
    const chartBox = (await chart.boundingBox())!;
    const plotWidth = chartBox.width - 100;
    await touchDrag(
      page,
      { x: chartBox.x + 84 + plotWidth / 6, y: chartBox.y + 40 },
      { x: chartBox.x + 84 + (plotWidth * 4) / 6, y: chartBox.y + 40 },
    );
    await expectCompactMap(page);
    await expect(
      streams.getByRole("button", { name: "Reset zoom", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Expand map", exact: true }).click();
    await expectDetails(page);
    await drawer.getByRole("button", { name: "Close", exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Route exploration", exact: true }),
    ).toBeVisible();
    await expect(
      streams.getByRole("button", { name: "Reset zoom", exact: true }),
    ).toHaveCount(0);
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
    await explorer(page).getByRole("slider", { name: "Segment start" }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(metric(page, "Elapsed Time")).toHaveText("0:20");
    await expect(metric(page, "Distance")).toHaveText("—");
    await expect(metric(page, "Ascent")).toHaveText("0 m");
    await expect(metric(page, "Avg gradient")).toHaveText("—");
    await expect(
      details(page).getByRole("img", {
        name: "Segment elevation profile",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      details(page).getByText(
        "Gradient unavailable without recorded distance.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await expect(
      segment(page).getByText("Avg HR", { exact: true }),
    ).toHaveCount(0);
    await expect(
      segment(page).getByText("Avg Power", { exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath("compact.png") });
  });

  test("touch resizing previews the segment on the map and opens its drawer only on release", async ({
    page,
    viewsFixture: f,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/activities/${f.ids.long}`);
    await page.getByRole("button", { name: "Expand map", exact: true }).click();
    const start = explorer(page).getByRole("slider", { name: "Segment start" });
    const end = explorer(page).getByRole("slider", { name: "Segment end" });
    await start.focus();
    await page.keyboard.press("ArrowRight");
    await end.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    const edge = (await explorer(page)
      .getByRole("button", { name: "Segment end", exact: true })
      .boundingBox())!;
    const point = await routePoint(page, 5);
    await touchDrag(
      page,
      { x: edge.x + 20, y: edge.y + 20 },
      { x: point.x + 20, y: point.y + 20 },
      async () => {
        await expect(end).toHaveAttribute("aria-valuenow", "500");
        await expect(details(page)).toHaveCount(0);
      },
    );
    await expect(metric(page, "Elapsed Time")).toHaveText("0:40");
    await expect(metric(page, "Distance")).toHaveText("0.40 km");
    await details(page)
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(segment(page)).toHaveCount(0);
    await expect(
      explorer(page).getByRole("button", { name: "Segment end", exact: true }),
    ).toHaveCount(0);
    await expect(profile(page)).toBeVisible();
  });
});
