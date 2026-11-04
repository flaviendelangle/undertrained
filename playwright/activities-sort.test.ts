import { expect, origin, test } from "./helpers/activityViews";

test("clicking an Activities header cycles its sort back to the default", async ({
  page,
  viewsFixture: _f,
}) => {
  await page.goto(`${origin}/activities`);
  const date = page.getByRole("columnheader", { name: /^Date/ });
  const distance = page.getByRole("columnheader", { name: /^Distance/ });
  await expect(date).toHaveAttribute("aria-sort", "descending");

  // Numbers sort descending first, then ascending, then clear to the default.
  for (const [dateSort, distanceSort] of [
    ["none", "descending"],
    ["none", "ascending"],
    ["descending", "none"],
  ]) {
    await distance.getByRole("button").click();
    await expect(distance).toHaveAttribute("aria-sort", distanceSort);
    await expect(date).toHaveAttribute("aria-sort", dateSort);
  }

  // The date column never clears into itself: it just flips direction.
  for (const sort of ["ascending", "descending", "ascending"]) {
    await date.getByRole("button").click();
    await expect(date).toHaveAttribute("aria-sort", sort);
  }
  await page.reload();
  await expect(date).toHaveAttribute("aria-sort", "ascending");
});
