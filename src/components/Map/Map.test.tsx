// @vitest-environment happy-dom
import * as React from "react";

import * as L from "leaflet";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { MapActivity } from "@server/db/types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { encode } from "~/utils/polyline";

import Map from "./Map";

// happy-dom has no canvas context. Use Leaflet's real SVG renderer instead.
vi.hoisted(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(SVGSVGElement.prototype, "createSVGRect", {
    configurable: true,
    value: () => ({}),
  });
});

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const activities: MapActivity[] = [
  {
    id: 1,
    stravaId: 101,
    type: "Ride",
    name: "Morning ride",
    startDate: "2026-10-23T08:00:00Z",
    startDateLocal: "2026-10-23T08:00:00Z",
    distance: 10000,
    movingTime: 1800,
    totalElevationGain: 100,
    mapPolyline: encode([
      [48.85, 2.35],
      [48.86, 2.36],
    ]),
  },
  {
    id: 2,
    stravaId: 102,
    type: "Ride",
    name: "Evening ride",
    startDate: "2026-10-24T18:00:00Z",
    startDateLocal: "2026-10-24T18:00:00Z",
    distance: 15000,
    movingTime: 2400,
    totalElevationGain: 200,
    mapPolyline: encode([
      [48.87, 2.37],
      [48.88, 2.38],
    ]),
  },
];

it("preserves the activity popover and viewport across readiness callback changes, then fits new routes", () => {
  const fitBounds = vi.spyOn(L.Map.prototype, "fitBounds");
  const { container, rerender } = render(
    <Map activities={activities} fitMode="last" onReady={vi.fn()} />,
  );
  const map = fitBounds.mock.contexts[0] as L.Map;
  act(() => {
    map.setView([48.86, 2.36], 15, { animate: false });
  });
  const center = map.getCenter();
  const zoom = map.getZoom();

  fireEvent.click(container.querySelector("path")!, {
    clientX: 200,
    clientY: 200,
  });
  expect(screen.queryByText("Morning ride")).not.toBeNull();

  const onReady = vi.fn();
  rerender(<Map activities={activities} fitMode="last" onReady={onReady} />);

  expect(screen.queryByText("Morning ride")).not.toBeNull();
  expect(map.getCenter()).toEqual(center);
  expect(map.getZoom()).toBe(zoom);

  act(() => {
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) layer.fire("load");
    });
  });
  expect(onReady).toHaveBeenCalledOnce();

  rerender(
    <Map activities={[activities[1]]} fitMode="last" onReady={onReady} />,
  );
  expect(map.getCenter()).not.toEqual(center);
  expect(screen.queryByText("Morning ride")).toBeNull();
  expect(onReady).toHaveBeenCalledOnce();
});
