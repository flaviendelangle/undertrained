// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  DEFAULT_RIDER_SETTINGS_TIMELINE,
  type SessionDataPoint,
} from "~/sensors/types";

import { FtpTestResult } from "./FtpTestResult";

const settings = vi.hoisted(() => ({
  setTimeline: vi.fn(),
  retrySave: vi.fn(),
  saveStatus: "idle",
  mobile: false,
}));
vi.mock("~/hooks/useRiderSettings", () => ({
  useRiderSettingsTimeline: () => ({
    timeline: DEFAULT_RIDER_SETTINGS_TIMELINE,
    hasSettings: true,
    currentSettings: { ftp: 200 },
    ...settings,
  }),
}));
vi.mock("~/hooks/useIsMobile", () => ({ useIsMobile: () => settings.mobile }));
const points: SessionDataPoint[] = Array.from({ length: 60 }, (_, i) => ({
  timestamp: 1700000000000 + i * 1000,
  elapsed: 360 + i,
  power: 300,
  segmentIndex: 2,
  targetPower: 300,
  heartRate: null,
  cadence: 85,
  speed: 10,
  distance: i * 10,
}));
beforeEach(() => {
  vi.clearAllMocks();
  settings.saveStatus = "idle";
  settings.mobile = false;
});
afterEach(cleanup);
it.each([false, true])(
  "opens a result modal and only stores FTP after acceptance (mobile=%s)",
  async (mobile) => {
    settings.mobile = mobile;
    render(<FtpTestResult id="ramp-test" points={points} />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("225");
    expect(settings.setTimeline).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "workouts.builtIn.apply" }),
    );
    const timeline = settings.setTimeline.mock.calls[0][0];
    expect(timeline.changes.at(-1).ftp).toBe(225);
    expect(timeline.initialValues).toEqual(
      DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues,
    );
  },
);
it("allows dismissal without modifying settings", async () => {
  render(<FtpTestResult id="ramp-test" points={points} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "workouts.builtIn.keepFtp" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(settings.setTimeline).not.toHaveBeenCalled();
});
it("reports an incomplete test without offering to store an FTP", async () => {
  render(<FtpTestResult id="ftp-test-20" points={points} />);
  expect((await screen.findByRole("dialog")).textContent).toContain(
    "workouts.builtIn.noResult",
  );
  expect(
    screen.queryByRole("button", { name: "workouts.builtIn.apply" }),
  ).toBeNull();
});
it("keeps a failed save retryable and confirms success", async () => {
  const { rerender } = render(<FtpTestResult id="ramp-test" points={points} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "workouts.builtIn.apply" }),
  );
  settings.saveStatus = "error";
  rerender(<FtpTestResult id="ramp-test" points={points} />);
  expect(screen.getByRole("alert").textContent).toBe("common.saveError");
  fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
  expect(settings.retrySave).toHaveBeenCalledOnce();
  settings.saveStatus = "success";
  rerender(<FtpTestResult id="ramp-test" points={points} />);
  expect(
    screen
      .getByRole("button", { name: "common.saved" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
