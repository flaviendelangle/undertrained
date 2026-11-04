// @vitest-environment happy-dom
import { useState } from "react";

import { afterEach, expect, it, vi } from "vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  DEFAULT_RIDER_SETTINGS_TIMELINE,
  type RiderSettingsTimeline,
} from "~/sensors/types";

import { RIDER_FIELD_CONFIG } from "../fieldConfig";
import { MetricRow } from "./MetricRow";

vi.mock("~/i18n/useT", async () => {
  const { translate } = await import("~/i18n/t");
  const { default: en } = await import("~/i18n/messages/en");
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(en, en, "en-GB", key, params);
  return { useT: () => t, useLocale: () => ({ locale: "en-GB" }) };
});
// The sparkline pulls in MUI X charts; it plays no part in focus handling.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
afterEach(cleanup);

const ftp = RIDER_FIELD_CONFIG.find((c) => c.field === "ftp")!;

function Harness() {
  const [timeline, setTimeline] = useState<RiderSettingsTimeline>({
    ...DEFAULT_RIDER_SETTINGS_TIMELINE,
    initialValues: { ...DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues },
    changes: [
      { id: "jan", date: "2026-01-01", ftp: 250 },
      { id: "mar", date: "2026-03-01", ftp: 260 },
    ],
  });
  return (
    <MetricRow
      config={ftp}
      timeline={timeline}
      onTimelineChange={setTimeline}
      hasSettings
    />
  );
}

it("moves focus to the next row, then the start value, as dated values are deleted", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "FTP" }));

  const deleteMarch = screen.getByRole("button", {
    name: "Delete the 1 Mar 2026 value",
  });
  deleteMarch.focus();
  fireEvent.click(deleteMarch);
  expect(
    screen.queryByRole("button", { name: "Delete the 1 Mar 2026 value" }),
  ).toBeNull();
  const deleteJanuary = screen.getByRole("button", {
    name: "Delete the 1 Jan 2026 value",
  });
  expect(document.activeElement).toBe(deleteJanuary);

  fireEvent.click(deleteJanuary);
  expect(screen.queryByRole("button", { name: /^Delete the/ })).toBeNull();
  expect(document.activeElement?.getAttribute("aria-label")).toMatch(
    /^Edit FTP, Start/,
  );
});
