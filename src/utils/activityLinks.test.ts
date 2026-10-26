import { expect, it } from "vitest";

import { activityHref, readReturnTo } from "./activityLinks";

it("returns from an activity to the linking page, never off the app", () => {
  const href = activityHref(7, "/journal/week?week=2026-01-05");
  const query = Object.fromEntries(
    new URL(href, "https://undertrained.test").searchParams,
  );
  expect(readReturnTo(query)).toBe("/journal/week?week=2026-01-05");
  for (const returnTo of [
    "//evil.test",
    "/\\evil.test",
    "/\t/evil.test",
    "https://evil.test",
  ])
    expect(readReturnTo({ returnTo })).toBeNull();
});
