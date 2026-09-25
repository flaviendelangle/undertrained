// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { WorkoutBuilder } from "./WorkoutBuilder";

vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    events: { on: vi.fn(), off: vi.fn() },
  }),
}));
vi.mock("~/hooks/useAthleteId", () => ({ useAthleteId: () => 1 }));
vi.mock("~/hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("~/hooks/useRiderSettings", () => ({
  useRiderSettingsTimeline: () => ({
    currentSettings: { ftp: 200 },
    configuredFtp: 200,
  }),
}));
vi.mock("~/utils/trpc", () => ({
  trpc: {
    useUtils: () => ({
      structuredWorkouts: { list: { invalidate: vi.fn() } },
    }),
    structuredWorkouts: {
      create: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      update: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
  },
}));
vi.mock("./WorkoutPreviewChart", () => ({ WorkoutPreviewChart: () => null }));
vi.mock("./WorkoutSummaryPanel", () => ({ WorkoutSummaryPanel: () => null }));

afterEach(cleanup);

it.each(["Up", "Down"] as const)(
  "moves a row %s from the keyboard menu without changing selection",
  async (direction) => {
    render(
      <WorkoutBuilder
        workout={{
          id: 1,
          name: "Workout",
          description: null,
          sport: "bike",
          structure: {
            version: 1,
            sport: "bike",
            nodes: ["a", "b", "c"].map((id) => ({
              id,
              type: "step",
              durationSeconds: 60,
              power: { kind: "free" },
            })),
          },
        }}
      />,
    );
    const rows = screen.getAllByRole("option");
    const trigger = within(rows[1]).getByRole("button", {
      name: "workouts.step.actions",
    });
    fireEvent.pointerDown(trigger);
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const moveUp = await screen.findByRole("menuitem", {
      name: "workouts.step.moveUp",
    });
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    moveUp.focus();
    if (direction === "Down") {
      fireEvent.keyDown(moveUp, { key: "ArrowDown" });
    }
    const action = screen.getByRole("menuitem", {
      name: `workouts.step.move${direction}`,
    });
    expect(document.activeElement).toBe(action);
    fireEvent.keyDown(action, { key: "Enter" });
    expect(
      screen.getAllByRole("option").map((row) => row.dataset.stepId),
    ).toEqual(direction === "Up" ? ["b", "a", "c"] : ["a", "c", "b"]);
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
  },
);
