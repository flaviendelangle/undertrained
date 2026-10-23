// @vitest-environment happy-dom
import type { ReactNode } from "react";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { ToastProvider } from "~/components/ui/toast";
import { STRUCTURED_WORKOUT_SCHEMA_VERSION } from "~/utils/structuredWorkout";

import { WorkoutBuilder, type WorkoutBuilderProps } from "./WorkoutBuilder";

const backend = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
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
vi.mock("~/utils/trpc", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    trpc: {
      useUtils: () => ({
        structuredWorkouts: { list: { invalidate: vi.fn() } },
      }),
      structuredWorkouts: {
        create: {
          useMutation: (options: object) =>
            useMutation({ ...options, mutationFn: backend.create }),
        },
        update: {
          useMutation: (options: object) =>
            useMutation({ ...options, mutationFn: backend.update }),
        },
      },
    },
  };
});
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

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  backend.create.mockReset();
  backend.update.mockReset();
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
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
  backend.update.mockRejectedValue(new Error("offline"));
  render(<WorkoutBuilder workout={workout} />, { wrapper });

  fireEvent.click(
    screen.getByRole("button", { name: "workouts.updateWorkout" }),
  );

  // `All`: the toast's text is mirrored into a screen-reader announcement.
  expect(await screen.findAllByText("common.saveError")).not.toHaveLength(0);
  expect(backend.update).toHaveBeenCalledOnce();
});
