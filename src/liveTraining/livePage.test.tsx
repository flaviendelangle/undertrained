// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import LiveTrainingPage from "~/pages/workouts/live";
import {
  type FakeSensorAdapters,
  createFakeSensorAdapters,
} from "~/sensors/fakeAdapters";
import { DEFAULT_RIDER_SETTINGS } from "~/sensors/types";
import { makeStep, makeWorkout } from "~/utils/structuredWorkout/fixtures";

/**
 * The page wiring: buttons reach the engine, and what the engine publishes
 * reaches the screen. The ride's behaviour is covered by `rideEngine.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  sensors: null as unknown as FakeSensorAdapters,
}));
vi.mock("~/sensors/sources", () => ({
  createSensorAdapters: () => mocks.sensors,
}));
vi.mock("~/i18n/useT", () => {
  const t = (key: string) => key;
  return { useT: () => t };
});
vi.mock("~/hooks/useAthleteId", () => ({ useAthleteId: () => 1 }));
vi.mock("~/hooks/useRiderSettings", () => ({
  useRiderSettings: () => [DEFAULT_RIDER_SETTINGS],
  useRiderSettingsTimeline: () => ({ configuredFtp: 200 }),
}));
vi.mock("~/utils/trpc", () => ({
  trpc: {
    structuredWorkouts: {
      get: {
        useQuery: () => ({
          data: {
            id: 1,
            name: "Steady",
            structure: makeWorkout([makeStep("steady", 600, 1)]),
          },
          isError: false,
        }),
      },
    },
  },
}));
vi.mock("next/router", () => ({
  useRouter: () => ({
    asPath: "/workouts/live",
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    beforePopState: vi.fn(),
    push: vi.fn(),
  }),
}));
vi.mock("~/components/liveTraining/PowerHrChart", () => ({
  PowerHrChart: () => null,
}));
vi.mock("~/components/liveTraining/ExportPanel", () => ({
  ExportPanel: () => null,
}));

beforeEach(() => {
  vi.useFakeTimers();
  mocks.sensors = createFakeSensorAdapters();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const trainer = () => mocks.sensors.trainer["ant+"];

async function wait(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

it("rides a workout from the wizard to the summary", async () => {
  const { unmount } = render(
    <LiveTrainingPage initialWorkoutId={1} initialBuiltInId={null} />,
  );

  // The heart rate card comes first, then the trainer's.
  const [, connectTrainer] = screen.getAllByRole("button", {
    name: "liveTraining.connect",
  });
  await act(async () => {
    fireEvent.click(connectTrainer);
    await Promise.resolve();
  });
  act(() => trainer().live.onControlAvailabilityChange(true));
  fireEvent.click(
    screen.getByRole("button", { name: "liveTraining.continueWithoutHr" }),
  );
  expect(
    screen
      .getByRole("switch", { name: "liveTraining.ergMode" })
      .getAttribute("aria-checked"),
  ).toBe("true");

  // Pedaling starts the ride.
  for (let second = 0; second < 3; second++) {
    act(() => trainer().live.onData({ power: 210, cadence: 90 }));
    await wait(1000);
  }
  expect(trainer().setTargetPower).toHaveBeenLastCalledWith(200);
  expect(
    screen.getAllByRole("button", { name: "liveTraining.pause" }),
  ).not.toHaveLength(0);

  // Coming back to the tab sends the target again.
  trainer().setTargetPower.mockClear();
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await wait(200);
  expect(trainer().setTargetPower).toHaveBeenCalledWith(200);

  fireEvent.click(
    screen.getAllByRole("button", { name: "liveTraining.pause" })[0],
  );
  expect(screen.getByText("liveTraining.paused")).toBeTruthy();
  expect(trainer().releaseControl).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByRole("button", { name: "liveTraining.resume" }));
  fireEvent.click(
    screen.getAllByRole("button", { name: "liveTraining.stop" })[0],
  );
  expect(screen.getByText("liveTraining.rideComplete")).toBeTruthy();

  unmount();
  expect(trainer().disconnect).toHaveBeenCalledOnce();
});
