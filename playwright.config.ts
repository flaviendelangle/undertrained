import { PlaywrightTestConfig, devices } from "@playwright/test";

const opts = {
  // launch headless on CI, in browser locally
  headless: !!process.env.CI || !!process.env.PLAYWRIGHT_HEADLESS,
  // collectCoverage: !!process.env.PLAYWRIGHT_HEADLESS
};
// `next start`/`next dev` both honour PORT, so overriding it moves the whole
// harness off 3000 — handy when a dev server is already sitting on it.
const port = Number(process.env.PORT ?? 3000);

const config: PlaywrightTestConfig = {
  testDir: "./playwright",
  timeout: 35e3,
  outputDir: "./playwright/test-results",
  // 'github' for GitHub Actions CI to generate annotations, plus a concise 'dot'
  // default 'list' when running locally
  reporter: process.env.CI ? "github" : "list",
  // A stray `test.only` would silently skip the rest of the suite on CI.
  forbidOnly: !!process.env.CI,
  use: {
    ...devices["Desktop Chrome"],
    headless: opts.headless,
    // Pin the locale so assertions on UI copy don't depend on the runner's
    // system language — I18nProvider falls back to matching `navigator.language`.
    locale: "en-GB",
    // Only keep artefacts for runs that actually failed; recording video for
    // every green test made the uploaded artefact large and useless.
    video: "retain-on-failure",
    trace: "on-first-retry",
  },
  retries: process.env.CI ? 3 : 0,
  webServer: {
    command: process.env.CI ? "npm run start" : "npm run dev",
    reuseExistingServer: Boolean(process.env.TEST_LOCAL === "1"),
    port,
  },
};

export default config;
