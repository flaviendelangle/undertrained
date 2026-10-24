// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PACE_METRIC } from "../PaceCard/paceMetric";
import { POWER_METRIC } from "../PowerCurve/powerMetric";
import { MetricOverTime } from "./MetricOverTime";
import { MetricSliceDistribution } from "./MetricSliceDistribution";
import { MetricZoneDistribution } from "./MetricZoneDistribution";

vi.mock("~/hooks/useIsMobile", () => ({ useIsMobile: () => false }));
// Real English copy, so the assertions read like what the user sees.
vi.mock("~/i18n/useT", async () => {
  const { translate } = await import("~/i18n/t");
  const { default: en } = await import("~/i18n/messages/en");
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(en, en, "en-GB", key, params);
  return { useT: () => t };
});

beforeAll(() => {
  // MUI X Pro reports usage on render; keep tests off the network.
  vi.stubEnv("MUI_X_TELEMETRY_DISABLED", "true");
  // MUI X sizes the chart from its container's computed style, which
  // happy-dom leaves empty; give every element a plot-sized box.
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element: Element) => {
    const style = getComputedStyle(element);
    return new Proxy(style, {
      get(target, prop) {
        if (prop === "width") return "800px";
        if (prop === "height") return "400px";
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  };
});
afterEach(cleanup);

/** Zone chips in render order, e.g. `["Z7", …, "Z0"]`. */
function zoneCodes() {
  return screen.getAllByText(/^Z\d[a-c]?$/).map((el) => el.textContent);
}

/** Text of the zone row whose chip reads `code`. */
function zoneRow(code: string) {
  return screen.getByText(code).parentElement?.textContent;
}

describe("MetricZoneDistribution", () => {
  it("lists power zones hardest first, with coasting and watt ranges", () => {
    render(
      <MetricZoneDistribution
        metric={POWER_METRIC}
        values={[0, 0, 100, 100, 100, 160, 400]}
        threshold={250}
      />,
    );
    expect(zoneCodes()).toEqual([
      "Z7",
      "Z6",
      "Z5",
      "Z4",
      "Z3",
      "Z2",
      "Z1",
      "Z0",
    ]);
    expect(zoneRow("Z0")).toContain("Coasting0 W0:02");
    expect(zoneRow("Z2")).toContain("Endurance139–188 W0:01");
    expect(zoneRow("Z7")).toContain("Neuromuscular376+ W0:01");
    screen.getByText("Based on an FTP of 250 W.");
  });

  it("uses pre-aggregated power totals without ranges", () => {
    render(
      <MetricZoneDistribution
        metric={POWER_METRIC}
        values={[]}
        threshold={250}
        zoneSeconds={[60, 0, 0, 0, 0, 0, 0]}
        zeroSeconds={30}
        aggregate
      />,
    );
    expect(zoneRow("Z1")).toBe("Z1Recovery1:0067 %");
    expect(zoneRow("Z0")).toBe("Z0Coasting0:3033 %");
    screen.getByText("Based on the FTP in effect for each activity.");
  });

  it("lists pace zones fastest first, with open-ended pace ranges", () => {
    render(
      <MetricZoneDistribution
        metric={PACE_METRIC}
        values={[2, 2, 4, 5]}
        threshold={4}
      />,
    );
    expect(zoneCodes()).toEqual(["Z5c", "Z5b", "Z5a", "Z4", "Z3", "Z2", "Z1"]);
    expect(zoneRow("Z5c")).toContain("Zone 5c< 3:44 /km0:01");
    expect(zoneRow("Z1")).toContain("Zone 1> 5:23 /km0:02");
    screen.getByText("Based on a threshold pace of 4:10 /km.");
  });

  it("asks for a missing threshold pace, while power without FTP is empty", () => {
    render(
      <MetricZoneDistribution
        metric={PACE_METRIC}
        values={[3]}
        threshold={0}
      />,
    );
    screen.getByText(
      "Set your run threshold pace in Settings to see pace zones.",
    );
    cleanup();

    render(
      <MetricZoneDistribution
        metric={POWER_METRIC}
        values={[0, 200]}
        threshold={0}
      />,
    );
    screen.getByText("No power data available");
  });
});

describe("MetricSliceDistribution", () => {
  it.each([
    {
      name: "power",
      metric: POWER_METRIC,
      // 25 W slices: 10, 20 → [0, 25); 60 → [50, 75).
      values: [10, 20, 60],
      sliceWidth: 25,
      threshold: 250,
      reference: 30,
      referenceLabel: "Weighted avg power 30 W",
      firstSlice: "0–25 W",
    },
    {
      name: "pace",
      metric: PACE_METRIC,
      // 15 s/km slices: 5 m/s = 200 s/km → [195, 210); 4 m/s = 250 s/km → [240, 255).
      values: [4, 4, 5],
      sliceWidth: 15,
      threshold: 4,
      reference: 4,
      referenceLabel: "Avg pace 4:10 /km",
      firstSlice: "3:15–3:30 /km",
    },
  ])(
    "labels the $name reference line and slice tooltip",
    ({ metric, values, sliceWidth, threshold, reference, ...expected }) => {
      const { container } = render(
        <MetricSliceDistribution
          metric={metric}
          values={values}
          threshold={threshold}
          sliceWidth={sliceWidth}
          reference={reference}
        />,
      );
      screen.getByText(expected.referenceLabel);

      const bars = container.querySelectorAll("rect[rx='1']");
      expect(bars).toHaveLength(2);
      fireEvent.mouseMove(bars[0], { clientX: 100, clientY: 100 });
      screen.getByText(expected.firstSlice);
    },
  );

  it("bins pre-aggregated power counts", () => {
    const { container } = render(
      <MetricSliceDistribution
        metric={POWER_METRIC}
        values={[]}
        frequency={[
          { watts: 0, seconds: 30 },
          { watts: 60, seconds: 10 },
        ]}
        threshold={250}
        sliceWidth={25}
        reference={null}
      />,
    );
    const bars = container.querySelectorAll("rect[rx='1']");
    fireEvent.mouseMove(bars[1], { clientX: 100, clientY: 100 });
    screen.getByText("50–75 W");
    screen.getByText("25 %");
  });
});

describe("MetricOverTime", () => {
  it.each([
    {
      name: "power",
      metric: POWER_METRIC,
      values: new Array<number>(120).fill(200),
      threshold: 250,
      valueAxis: "Power",
      tooltip: { value: "200 W", zone: "Tempo" },
      zoomable: true,
    },
    {
      name: "pace",
      metric: PACE_METRIC,
      values: new Array<number>(120).fill(4),
      threshold: 4,
      valueAxis: "Pace",
      tooltip: { value: "4:10 /km", zone: "Zone 4" },
      zoomable: false,
    },
  ])(
    "plots $name with its axis, tooltip and zoom",
    ({ metric, values, threshold, ...expected }) => {
      const { container } = render(
        <MetricOverTime
          metric={metric}
          values={values}
          threshold={threshold}
        />,
      );
      screen.getByText(expected.valueAxis);
      expect(
        container.querySelector(".MuiChartsAxisZoomSliderThumb-root") != null,
      ).toBe(expected.zoomable);

      const capture = container.querySelector("rect[pointer-events='all']")!;
      fireEvent.mouseMove(capture, { clientX: 300, clientY: 100 });
      const { value, zone } = expected.tooltip;
      expect(screen.getByText(zone).parentElement?.textContent).toBe(
        `${value}${zone}`,
      );
    },
  );
});
