// @vitest-environment happy-dom
import * as React from "react";

import { afterEach, expect, it, vi } from "vitest";

import type { MapActivity } from "@server/db/types";
import { cleanup, render, screen } from "@testing-library/react";

import { activityViewHref } from "~/utils/activityViewState";

import { HeatmapActivityTooltip } from "./Map/HeatmapActivityTooltip";
import { PowerCurveTooltip } from "./charts/PowerCurve/PowerCurveTooltip";

vi.mock("~/hooks/useActivityView", () => ({
  useActivityView: () => ({
    href: (path: string) => activityViewHref(path, { viewId: 42 }),
  }),
}));
afterEach(cleanup);

it("keeps the current selection on the heatmap activity link", () => {
  render(
    <HeatmapActivityTooltip
      activity={
        {
          stravaId: 7,
          name: "Morning ride",
          type: "Ride",
          startDateLocal: "2026-10-25T08:00:00",
          distance: 30000,
          movingTime: 3600,
          totalElevationGain: 0,
        } as MapActivity
      }
      position={{ x: 0, y: 0 }}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "/activities/7?view=42",
  );
});

it("keeps the current selection on the power curve activity link", () => {
  render(
    <PowerCurveTooltip
      clientX={0}
      containerRef={React.createRef()}
      duration={60}
      frozen
      entries={[
        {
          id: "best",
          label: "Best",
          color: "red",
          value: 300,
          unit: "W",
          activity: {
            activityStravaId: 7,
            activityName: "Morning ride",
            activityStartDate: "2026-10-25",
          },
        },
      ]}
    />,
  );
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "/activities/7?view=42",
  );
});
