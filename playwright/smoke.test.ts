import { expect, test } from "@playwright/test";

// The app has no index route and everything else is behind a Strava account, so
// these two pages are the whole signed-out surface. Between them they exercise
// the full boot path — server render, hydration, i18n and client-side routing —
// without needing credentials in CI.

test("the login page offers Strava sign-in", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "Undertrained", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Login with Strava" }),
  ).toBeVisible();
});

test("the toolbox works signed out", async ({ page }) => {
  // Straight to the tool: bare /toolbox client-redirects to this same URL, and
  // asserting through the redirect would race the router.
  await page.goto("/toolbox/pace-calculator");

  await expect(
    page.getByRole("button", { name: "Pace Calculator" }),
  ).toBeVisible();

  // The calculator computes on render, so a well-formed finish time means the
  // whole tool — not just its chrome — came up. Scoped to the result block:
  // the reference table below is full of times that would match too.
  const result = page.getByText("Finish Time", { exact: true }).locator("..");
  await expect(result).toContainText(/\d{2}:\d{2}:\d{2}/);

  // The signed-out toolbar shows "Sign in" instead of the account menu. It is
  // driven by `useSession()`, so seeing it proves the client tree hydrated
  // rather than just being server-painted.
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});
