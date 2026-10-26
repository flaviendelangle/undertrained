import {
  type ActivityCondition,
  type ActivityFilterGroup,
  DEFAULT_ACTIVITY_DISPLAY,
} from "../src/utils/activityFilters";
import { expect, origin, test } from "./helpers/activityViews";

const condition = (
  id: string,
  field: ActivityCondition["field"],
  operator: ActivityCondition["operator"],
  value = "",
  values: string[] = [],
  valueTo = "",
): ActivityCondition => ({
  kind: "condition",
  id,
  field,
  operator,
  value,
  values,
  valueTo,
});
const selection: ActivityFilterGroup = {
  kind: "group",
  id: "root",
  join: "AND",
  children: [
    condition("commutes", "commute", "eq", "false"),
    {
      kind: "group",
      id: "either",
      join: "OR",
      children: [
        {
          kind: "group",
          id: "rides",
          join: "AND",
          children: [
            condition("sport", "sport", "in", "", ["Ride"]),
            condition("distance", "distance", "ge", "40"),
          ],
        },
        condition("race", "workoutKind", "in", "", ["race"]),
      ],
    },
  ],
};

test("nested selection agrees across list, routes, counts and power analytics", async ({
  viewsFixture: f,
}) => {
  const input = {
    athleteId: f.athleteId,
    rules: selection,
    today: "2026-01-10",
  };
  const [list, maps, summary, curve, distribution] = await Promise.all([
    f.client.activities.list.query(input),
    f.client.activities.maps.query(input),
    f.client.views.summary.query(input),
    f.client.analytics.getPowerCurve.query(input),
    f.client.analytics.getPowerDistribution.query(input),
  ]);
  expect(list.activities.map((a) => a.stravaId).sort()).toEqual(
    [f.ids.long, f.ids.race].sort(),
  );
  expect(maps.map((a) => a.stravaId).sort()).toEqual(
    [f.ids.long, f.ids.race].sort(),
  );
  expect(summary).toEqual({ count: 2, routes: 2 });
  expect(curve).toEqual([
    expect.objectContaining({
      duration: 60,
      watts: 200,
      activityStravaId: f.ids.long,
    }),
  ]);
  expect(distribution).toEqual([{ watts: 200, seconds: 2 }]);
  // The UTC timestamp is the next day. Dates and rolling ranges use activity-local days.
  for (const date of [
    condition("date", "date", "between", "2026-01-10", [], "2026-01-10"),
    condition("date", "date", "last", "1"),
  ]) {
    expect(
      (
        await f.client.views.summary.query({
          ...input,
          rules: {
            ...selection,
            children: [
              ...selection.children,
              date,
              condition("duration", "duration", "eq", "60"),
            ],
          },
        })
      ).count,
    ).toBe(2);
  }
  expect(
    (await f.client.views.summary.query({ ...input, dateFrom: "2026-01-11" }))
      .count,
  ).toBe(0);
  expect(
    (
      await f.client.activities.list.query({
        athleteId: f.athleteId,
        rules: {
          ...selection,
          children: [condition("text", "name", "contains", "% Alpine_")],
        },
      })
    ).activities.map((a) => a.stravaId),
  ).toEqual([f.ids.long]);
  expect(
    (
      await f.client.views.summary.query({
        athleteId: f.athleteId,
        rules: {
          ...selection,
          children: [
            condition("kind", "workoutKind", "notIn", "", ["race"]),
            condition("hr", "heartrate", "blank"),
          ],
        },
      })
    ).count,
  ).toBe(4);
});

test("views persist rules and display, stay private, and survive folder deletion", async ({
  viewsFixture: f,
}) => {
  const folder = await f.client.views.createFolder.mutate({
    athleteId: f.athleteId,
    name: "Training",
  });
  const otherFolder = await f.otherClient.views.createFolder.mutate({
    athleteId: f.otherId,
    name: "Other",
  });
  const fields = {
    athleteId: f.athleteId,
    name: "Long rides or races",
    folderId: folder.id,
    rules: selection,
    display: {
      ...DEFAULT_ACTIVITY_DISPLAY,
      columns: ["name", "distance"] as ("name" | "distance")[],
      groupBy: "sport" as const,
    },
  };
  const view = await f.client.views.create.mutate(fields);
  expect(await f.client.views.list.query({ athleteId: f.athleteId })).toEqual([
    expect.objectContaining({
      name: fields.name,
      folderId: fields.folderId,
      rules: fields.rules,
      display: fields.display,
    }),
  ]);
  expect(
    (
      await f.client.views.counts.query({
        athleteId: f.athleteId,
        today: "2026-01-10",
      })
    )[view.id],
  ).toBe(2);
  await expect(
    f.client.views.update.mutate({
      ...fields,
      id: view.id,
      folderId: otherFolder.id,
    }),
  ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  await expect(
    f.otherClient.views.delete.mutate({ athleteId: f.otherId, id: view.id }),
  ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  await expect(
    f.client.views.list.query({ athleteId: f.otherId }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  await f.client.views.deleteFolder.mutate({
    athleteId: f.athleteId,
    id: folder.id,
  });
  expect(
    (await f.client.views.list.query({ athleteId: f.athleteId }))[0],
  ).toEqual(
    expect.objectContaining({
      id: view.id,
      folderId: null,
      rules: selection,
      display: fields.display,
    }),
  );
  await f.client.views.update.mutate({
    ...fields,
    id: view.id,
    folderId: null,
    rules: { ...selection, children: [] },
  });
  expect(
    (
      await f.client.views.counts.query({
        athleteId: f.athleteId,
        today: "2026-01-10",
      })
    )[view.id],
  ).toBe(5);
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`edit, preview, save and navigate a view at ${viewport.width}px`, async ({
    page,
    viewsFixture: f,
  }) => {
    await page.setViewportSize(viewport);
    const openViewOptions = async () => {
      if (viewport.width < 768)
        await page
          .getByRole("button", { name: "View options", exact: true })
          .click();
    };
    const closeViewOptions = async () => {
      if (viewport.width < 768)
        await page
          .getByRole("dialog", { name: "View options", exact: true })
          .getByRole("button", { name: "Close", exact: true })
          .click();
    };

    await page.goto(`${origin}/activities?edit=filters`);
    const dialog = page.getByRole("dialog", {
      name: viewport.width < 768 ? "View options" : "Activity filters",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Add AND/OR group", exact: true })
      .click();
    await expect(dialog.getByRole("treegrid").getByRole("row")).toHaveCount(3);
    await dialog
      .getByRole("combobox", { name: "Match", exact: true })
      .last()
      .click();
    await page
      .getByRole("option", { name: "Any of these", exact: true })
      .click();
    await dialog
      .getByRole("combobox", { name: "Activity property", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Distance, km", exact: true })
      .click();
    await dialog
      .getByRole("combobox", { name: "Comparison", exact: true })
      .click();
    await page
      .getByRole("option", { name: "is at least", exact: true })
      .click();
    await dialog
      .getByRole("spinbutton", { name: "Value", exact: true })
      .fill("40");
    await expect(
      dialog.getByText("2 activities", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `/tmp/undertrained-filter-${viewport.width}.png`,
    });
    await dialog
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await openViewOptions();
    await expect(
      page.getByText("Unsaved view", { exact: true }).last(),
    ).toBeVisible();
    await closeViewOptions();
    await page.screenshot({
      path: `/tmp/undertrained-view-bar-${viewport.width}.png`,
    });
    await openViewOptions();
    if (viewport.width < 768)
      await page.screenshot({ path: "/tmp/undertrained-view-drawer-390.png" });
    const workingUrl = page.url();
    await closeViewOptions();
    await page.reload();
    await openViewOptions();
    await expect(
      page.getByText("Unsaved view", { exact: true }).last(),
    ).toBeVisible();
    expect(await f.client.views.list.query({ athleteId: f.athleteId })).toEqual(
      [],
    );
    await page.getByRole("button", { name: "Save view", exact: true }).click();
    const saveDialog = page.getByRole("dialog", {
      name: viewport.width < 768 ? "View options" : "Save as new",
      exact: true,
    });
    if (viewport.width < 768)
      await expect(page.getByRole("dialog")).toHaveCount(1);
    await saveDialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Long activities");
    if (viewport.width < 768)
      await page.screenshot({ path: "/tmp/undertrained-inline-save-390.png" });
    await saveDialog
      .getByRole("button", { name: "Save view", exact: true })
      .click();
    await expect(saveDialog).not.toBeVisible();
    await openViewOptions();
    await expect(
      page.getByRole("combobox", { name: "Saved views" }),
    ).toContainText("Long activities");
    await closeViewOptions();
    const [saved] = await f.client.views.list.query({ athleteId: f.athleteId });
    expect(saved.rules.children[0]).toMatchObject({
      kind: "group",
      join: "OR",
    });
    if (viewport.width >= 768) {
      const toolbar = page.getByRole("toolbar", {
        name: "View options",
        exact: true,
      });
      await toolbar.getByRole("combobox", { name: "Saved views" }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        toolbar.getByRole("button", { name: "Edit filters (1)", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect(
        toolbar.getByRole("button", { name: "Display", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      const displayDialog = page.getByRole("dialog", {
        name: "Display",
        exact: true,
      });
      await expect(displayDialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(displayDialog).not.toBeVisible();
      await toolbar.getByRole("combobox", { name: "Saved views" }).focus();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("option", { name: saved.name, exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await page
      .getByRole("link", { name: "Charts", exact: true })
      .last()
      .click();
    await expect(page).toHaveURL(/\/activities\/charts\?/);
    await openViewOptions();
    await expect(
      page.getByRole("combobox", { name: "Saved views" }),
    ).toContainText(saved.name);
    await expect(page.getByText("2 activities", { exact: true })).toBeVisible();
    await closeViewOptions();
    await page.getByRole("link", { name: "Map", exact: true }).last().click();
    await expect(page).toHaveURL(/\/activities\/map\?/);
    await openViewOptions();
    await expect(
      page.getByText("1 routes from 2 selected activities", { exact: true }),
    ).toBeVisible();
    await closeViewOptions();
    await expect(
      page
        .getByRole("toolbar", { name: "Activities", exact: true })
        .getByRole("button", { name: "Map menu", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Map menu", exact: true }).click();
    await page
      .getByRole("menuitemcheckbox", { name: "Explorer Tiles", exact: true })
      .click();
    await expect(
      page.getByRole("menuitemcheckbox", {
        name: "Explorer Tiles",
        exact: true,
      }),
    ).toHaveAttribute("aria-checked", "true");
    await page
      .getByRole("menuitemradio", { name: "Satellite", exact: true })
      .click();
    await page.getByRole("button", { name: "Map menu", exact: true }).click();
    await expect(
      page.getByRole("menuitemradio", { name: "Satellite", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await page.goto(`${origin}/statistics?view=${saved.id}`);
    await expect(page).toHaveURL(
      `${origin}/activities/charts?view=${saved.id}`,
    );
    await page.goto(`${origin}/map/heatmap?view=${saved.id}`);
    await expect(page).toHaveURL(`${origin}/activities/map?view=${saved.id}`);
    await expect(
      page
        .getByRole("toolbar", { name: "Activities", exact: true })
        .getByRole("button", { name: "Sync", exact: true }),
    ).toHaveCount(0);
    if (viewport.width < 768) {
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("menuitem", { name: "Sync", exact: true }).click();
    } else
      await page.getByRole("button", { name: "Sync", exact: true }).click();
    const syncPanel = page.getByRole("dialog", { name: "Sync", exact: true });
    await expect(syncPanel).toBeVisible();
    if (viewport.width >= 768)
      expect((await syncPanel.boundingBox())?.x).toBeLessThan(100);
    await page.keyboard.press("Escape");
    await expect(syncPanel).not.toBeVisible();
    await page.goto(`${origin}/activities?view=999999999`);
    await expect(
      page.getByText("This saved view no longer exists or is unavailable.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByRole("table")).not.toBeVisible();
    await page.goto(workingUrl);
    await openViewOptions();
    await expect(
      page.getByText("Unsaved view", { exact: true }).last(),
    ).toBeVisible();
    await closeViewOptions();
    if (viewport.width < 768) {
      const trigger = page.getByRole("button", {
        name: "View options",
        exact: true,
      });
      await expect(trigger).toHaveCount(1);
      await expect(trigger).toContainText("1");
      await expect(
        page.getByRole("button", { name: "Edit filters (1)", exact: true }),
      ).toHaveCount(0);
    } else
      await expect(
        page.getByRole("button", { name: "Edit filters (1)", exact: true }),
      ).toBeVisible();
  });
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`move a view between folders by dragging at ${viewport.width}px`, async ({
    page,
    context,
    viewsFixture: f,
  }) => {
    const folder = await f.client.views.createFolder.mutate({
      athleteId: f.athleteId,
      name: "Voyages",
    });
    const view = await f.client.views.create.mutate({
      athleteId: f.athleteId,
      name: "Alpes 2026",
      folderId: null,
      rules: selection,
      display: DEFAULT_ACTIVITY_DISPLAY,
    });
    await context.addCookies([{ name: "locale", value: "fr-FR", url: origin }]);
    await page.setViewportSize(viewport);
    await page.goto(`${origin}/views`);
    const folders = page.getByRole("navigation", {
      name: "Dossier",
      exact: true,
    });
    await expect(
      folders.getByRole("button", { name: "Toutes les vues", exact: true }),
    ).toBeVisible();
    const row = page.getByRole("listitem").filter({
      has: page.getByRole("link", { name: view.name }),
    });
    const move = row.getByRole("button", {
      name: `Déplacer ${view.name}`,
      exact: true,
    });
    const start = await move.boundingBox();
    expect(start).not.toBeNull();
    await page.mouse.move(
      start!.x + start!.width / 2,
      start!.y + start!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(start!.x + 35, start!.y + 10, { steps: 6 });
    const preview = page.locator("[data-drag-preview]:visible");
    await expect(preview).toHaveText(view.name);
    const previewBox = await preview.boundingBox();
    expect(previewBox?.width).toBeLessThan(260);
    expect(previewBox?.height).toBeLessThan(50);
    expect(
      Math.abs(previewBox!.x + previewBox!.width / 2 - (start!.x + 35)),
    ).toBeLessThan(2);
    expect(previewBox!.y - (start!.y + 10)).toBeCloseTo(8, 0);
    expect(previewBox!.width).toBeLessThan((await row.boundingBox())!.width);
    const target = folders.getByRole("button", {
      name: folder.name,
      exact: true,
    });
    const targetBox = await target.boundingBox();
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 10 },
    );
    await expect(target).toHaveAttribute("data-drag-over");
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await f.client.views.list.query({ athleteId: f.athleteId }))[0]
            .folderId,
      )
      .toBe(folder.id);
    await expect(row).toContainText(folder.name);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(row).toContainText(folder.name);
    await move.dragTo(
      folders.getByRole("button", { name: "Sans dossier", exact: true }),
    );
    await expect
      .poll(
        async () =>
          (await f.client.views.list.query({ athleteId: f.athleteId }))[0]
            .folderId,
      )
      .toBeNull();
    await expect(row).toContainText("Sans dossier");
    await row
      .getByRole("button", { name: `Gérer les vues ${view.name}`, exact: true })
      .click();
    const rename = page.getByRole("menuitem", {
      name: "Renommer / Déplacer",
      exact: true,
    });
    await expect(rename).toBeVisible();
    const lineCount = await rename.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set(
        [...range.getClientRects()].map((rect) => Math.round(rect.top)),
      ).size;
    });
    expect(lineCount).toBe(1);
    await page.keyboard.press("Escape");
    await move.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Renommer", exact: true }),
    ).toBeVisible();
  });
}

test("Journal tabs preserve the selected week and ignore retired filters", async ({
  page,
  context,
  viewsFixture: _fixture,
}) => {
  await context.addCookies(
    Object.entries({
      "activity-type": ["Swim"],
      "workout-type": [11],
      "hide-commutes": true,
      "journal-date-from": "2099-01-01",
    }).map(([name, value]) => ({
      name,
      value: encodeURIComponent(JSON.stringify(value)),
      url: origin,
    })),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/journal/month?week=2026-01-05`);
  const header = page.getByRole("toolbar", { name: "Journal", exact: true });
  await expect(
    header.getByRole("heading", { name: "Journal", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Filter", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "+2 more", exact: true }).click();
  const dayActivities = page.getByRole("dialog");
  for (const name of ["100% Alpine_ride", "Race: race", "commute"])
    await expect(
      dayActivities.getByRole("link", { name, exact: true }),
    ).toBeVisible();
  await page.keyboard.press("Escape");
  await header.getByRole("link", { name: "Month", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    header.getByRole("link", { name: "Week", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${origin}/journal/week?week=2026-01-05`);
  await expect(
    header.getByRole("link", { name: "Week", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await header.getByRole("link", { name: "Month", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/journal/month?week=2026-01-05`);
});

test("Fitness keeps full history and exposes a selected day's details", async ({
  page,
  viewsFixture: f,
}) => {
  await f.client.plannedTrainings.create.mutate({
    athleteId: f.athleteId,
    title: "Planned intervals",
    sportType: "Ride",
    plannedDate: "2026-01-10T10:00:00",
    durationSeconds: 3600,
    workoutChoice: "workout",
  });
  await f.client.plannedTrainings.create.mutate({
    athleteId: f.athleteId,
    title: "Tomorrow plan",
    sportType: "Run",
    plannedDate: "2026-01-11T10:00:00",
    durationSeconds: 1800,
    workoutChoice: "workout",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseHistory!: () => void;
  const historyGate = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  await page.route("**/api/trpc/**", async (route) => {
    if (route.request().url().includes("activities.list")) await historyGate;
    await route.continue();
  });
  await page.goto(`${origin}/fitness?rules=invalid`);
  try {
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expect(
      page.getByLabel("Selected day", { exact: true }),
    ).not.toBeVisible();
  } finally {
    releaseHistory();
  }

  await page.getByLabel("Selected day", { exact: true }).fill("2026-01-10");
  const chart = page.getByLabel("Fitness chart", { exact: true });
  await expect(chart).toBeVisible();
  const chartBox = await chart.boundingBox();
  expect(chartBox?.height).toBeGreaterThan(250);
  expect(chartBox?.x).toBe(0);
  expect(chartBox?.width).toBe(390);
  await page.screenshot({
    path: "/tmp/undertrained-fitness-390.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("heading", { name: "Activities on this day" }),
  ).toBeVisible();
  for (const name of ["100% Alpine_ride", "race", "short", "commute", "easy"])
    await expect(
      page.getByRole("link").filter({ hasText: name }).last(),
    ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Planned: Planned intervals",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Planned: Tomorrow plan", exact: true }),
  ).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("link", { name: "100% Alpine_ride", exact: true })
    .hover();
  await expect(page.getByText("100% Alpine_ride", { exact: true })).toHaveCount(
    2,
  );
  await page.getByLabel("Selected day", { exact: true }).fill("2026-01-11");
  await expect(
    page.getByRole("link", { name: "100% Alpine_ride", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Planned: Tomorrow plan", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("All activities · full training history", { exact: true }),
  ).toBeVisible();
});

test("routes have a standalone library and legacy links redirect", async ({
  page,
  viewsFixture: _fixture,
}) => {
  await page.goto(`${origin}/routes`);
  await expect(
    page.getByRole("toolbar", { name: "My routes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "My routes", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Map menu", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "New route", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/routes/new`);
  await page.goto(`${origin}/map/routes`);
  await expect(page).toHaveURL(`${origin}/routes`);
});
