import { expect, it } from "vitest";

import { nearestRouteIndex, routeSegments } from "./routeGeometry";

it("leaves GPS gaps disconnected and preserves original sample indices when picking the route", () => {
  const positions = [
    [45, 5],
    [45.01, 5.01],
    null,
    [46, 6],
    [46.01, 6.01],
    [100, 200],
  ] as unknown as [number, number][];
  expect(routeSegments(positions)).toEqual([
    [
      [45, 5],
      [45.01, 5.01],
    ],
    [
      [46, 6],
      [46.01, 6.01],
    ],
  ]);
  expect(nearestRouteIndex(positions, 46.001, 6.001)).toBe(3);
});
