// @vitest-environment happy-dom
import type { ReactNode } from "react";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { ToastProvider } from "~/components/ui/toast";
import { STRUCTURED_WORKOUT_SCHEMA_VERSION } from "~/utils/structuredWorkout";
import { createTestBackend } from "~/utils/trpcTestBackend";

import { WorkoutBuilder, type WorkoutBuilderProps } from "./WorkoutBuilder";

vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    events: { on: vi.fn(), off: vi.fn() },
  }),
}));
vi.mock("~/hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("~/hooks/useRiderSettings", () => ({
  useRiderSettingsTimeline: () => ({
    currentSettings: { ftp: 200 },
    configuredFtp: 200,
  }),
}));
vi.mock("./WorkoutPreviewChart", () => ({ WorkoutPreviewChart: () => null }));
vi.mock("./WorkoutSummaryPanel", () => ({ WorkoutSummaryPanel: () => null }));

const workout: NonNullable<WorkoutBuilderProps["workout"]> = {
  id: 1,
  name: "Workout",
  description: null,
  sport: "bike",
  structure: {
    version: STRUCTURED_WORKOUT_SCHEMA_VERSION,
    sport: "bike",
    nodes: ["a", "b", "c"].map((id) => ({
      id,
      type: "step",
      durationSeconds: 60,
      power: { kind: "free" },
    })),
  },
};

const update = vi.fn();
let server: ReturnType<typeof createTestBackend>;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <server.Wrapper>
      <ToastProvider>{children}</ToastProvider>
    </server.Wrapper>
  );
}
beforeEach(() => {
  update.mockReset();
  server = createTestBackend({ structuredWorkouts: { update } });
});
afterEach(() => {
  cleanup();
  server.queryClient.clear();
});

it.each(["Up", "Down"] as const)(
  "moves a row %s from the keyboard menu without changing selection",
  async (direction) => {
    render(<WorkoutBuilder workout={workout} />, { wrapper });
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

it("tells the athlete when a save fails", async () => {
  update.mockRejectedValue(new Error("offline"));
  render(<WorkoutBuilder workout={workout} />, { wrapper });

  fireEvent.click(
    screen.getByRole("button", { name: "workouts.updateWorkout" }),
  );

  // `All`: the toast's text is mirrored into a screen-reader announcement.
  expect(await screen.findAllByText("common.saveError")).not.toHaveLength(0);
  expect(update).toHaveBeenCalledOnce();
});
