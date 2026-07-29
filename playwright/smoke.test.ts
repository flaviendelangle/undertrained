import { expect, test } from "@playwright/test";

// The app has no index route and everything else is behind a Strava account, so
// these two pages are the whole signed-out surface. Between them they exercise
// the full boot path — the server answering at all, hydration, i18n and the
// client-side router — without needing credentials in CI. Both pages gate their
// first paint on `useSession()`/`router.isReady`, so anything visible here came
// from the hydrated client tree.

test("the login page offers Strava sign-in", async ({ page }) => {
  // Assert the status before the content: a missing key in `src/server/env.ts`
  // takes the whole server down at import time, so every route answers 500.
  // Without this the symptom is a locator timeout, which reads like a UI
  // regression instead of "the server never booted".
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

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
  const response = await page.goto("/toolbox/pace-calculator");
  expect(response?.status()).toBe(200);

  await expect(
    page.getByRole("button", { name: "Pace Calculator" }),
  ).toBeVisible();

  // The calculator computes on render, so a well-formed finish time means the
  // whole tool — not just its chrome — came up. Scoped to the result block:
  // the reference table below is full of times that would match too.
  const result = page.getByText("Finish Time", { exact: true }).locator("..");
  await expect(result).toContainText(/\d{2}:\d{2}:\d{2}/);

  // The signed-out toolbar offers a way back to sign-in rather than the account
  // menu. (This page has no server paint to speak of — it's statically
  // optimized, so `router.query.tab` is empty during prerender and the
  // component returns null until `router.isReady`. Every assertion here already
  // implies the client tree came up.)
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});
