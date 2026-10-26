// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import EddingtonChart from "./EddingtonChart";
import { EDDINGTON_SPORTS } from "./eddingtonSports";

const filteredTypes = vi.hoisted(() => ({ last: [] as readonly string[] }));

vi.mock("~/hooks/useActivitiesFilteredByType", () => ({
  useActivitiesFilteredByType: (types: readonly string[]) => {
    filteredTypes.last = types;
    return { activities: [] };
  },
}));
vi.mock("~/hooks/useEddingtonData", () => ({
  useEddingtonData: () => null,
}));
vi.mock("~/hooks/useIsMobile", () => ({ useIsMobile: () => false }));
afterEach(cleanup);

// The card's info button is a button too; only the sport toggles are pressable.
const sportToggles = () =>
  screen
    .queryAllByRole("button")
    .filter((button) => button.hasAttribute("aria-pressed"));

it("falls back to the available sport and restores the picked one", () => {
  const { rerender } = render(
    <EddingtonChart sports={["riding", "running"]} />,
  );
  expect(filteredTypes.last).toBe(EDDINGTON_SPORTS.riding.activityTypes);

  const [, runningToggle] = sportToggles();
  fireEvent.click(runningToggle);
  expect(filteredTypes.last).toBe(EDDINGTON_SPORTS.running.activityTypes);

  rerender(<EddingtonChart sports={["riding"]} />);
  expect(filteredTypes.last).toBe(EDDINGTON_SPORTS.riding.activityTypes);
  expect(sportToggles()).toHaveLength(0);

  rerender(<EddingtonChart sports={["riding", "running"]} />);
  expect(filteredTypes.last).toBe(EDDINGTON_SPORTS.running.activityTypes);
  expect(
    sportToggles().map((toggle) => toggle.getAttribute("aria-pressed")),
  ).toEqual(["false", "true"]);
});
