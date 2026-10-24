// @vitest-environment happy-dom
import * as React from "react";

import { afterEach, expect, it, onTestFinished, vi } from "vitest";

import type { PlannedTraining } from "@server/db/types";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { ToastProvider } from "~/components/ui/toast";
import { TEST_ATHLETE_ID, createTestBackend } from "~/utils/trpcTestBackend";

import { PlannedTrainingDialog } from "./PlannedTrainingDialog";

const activity = {
  id: 3,
  stravaId: 42,
  type: "Run",
  name: "Morning Run",
  workoutType: null as number | null,
  startDateLocal: "2026-08-10T07:00:00",
};
let mockActivities: (typeof activity)[] = [activity];
vi.mock("~/hooks/useActivitiesQuery", () => ({
  useActivitiesQuery: () => ({ data: mockActivities }),
}));

const plan = {
  id: 17,
  athlete: TEST_ATHLETE_ID,
  title: "Tempo",
  plannedDate: "2026-08-10T07:00:00",
  durationSeconds: 60 * 60,
  sportType: "Run",
  workoutChoice: "workout",
  status: "planned",
  structuredWorkoutId: null,
  linkedActivityId: null,
  createdAt: 1,
  updatedAt: 1,
} satisfies PlannedTraining;

afterEach(() => {
  cleanup();
  localStorage.clear();
  mockActivities = [activity];
});

/** The sport and Mark done pickers, in that order: the title can be a combobox too. */
function pickers() {
  const title = screen.getByLabelText("journal.dialog.title");
  return screen.getAllByRole("combobox").filter((el) => el !== title);
}

it("saves the type picked in the dialog before Mark done links the activity", async () => {
  const calls: string[] = [];
  let saved: PlannedTraining = plan;
  const { Wrapper, queryClient } = createTestBackend({
    plannedTrainings: {
      list: () => [saved],
      linkedActivityIds: () => [],
      update: ({ athleteId: _athleteId, ...fields }) => {
        calls.push("update");
        saved = { ...saved, ...fields };
      },
      markDone: () => {
        // The server links the plan as saved, so this is what Strava gets.
        calls.push(`markDone:${saved.workoutChoice}`);
      },
    },
  });
  onTestFinished(() => queryClient.clear());
  const onClose = vi.fn();
  render(
    <Wrapper>
      <ToastProvider>
        <PlannedTrainingDialog
          state={{ mode: "edit", training: plan }}
          onClose={onClose}
        />
      </ToastProvider>
    </Wrapper>,
  );

  fireEvent.click(
    await screen.findByRole("button", { name: "activities.edit.workout.race" }),
  );
  fireEvent.click(pickers()[1]);
  fireEvent.click(await screen.findByRole("option", { name: /Morning Run/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "journal.dialog.markDone" }),
  );

  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(calls).toEqual(["update", "markDone:race"]);
});

it("drops a picked activity the edited sport no longer matches", async () => {
  const { Wrapper, queryClient } = createTestBackend({
    plannedTrainings: {
      list: () => [plan],
      linkedActivityIds: () => [],
    },
  });
  onTestFinished(() => queryClient.clear());
  render(
    <Wrapper>
      <ToastProvider>
        <PlannedTrainingDialog
          state={{ mode: "edit", training: plan }}
          onClose={vi.fn()}
        />
      </ToastProvider>
    </Wrapper>,
  );

  await screen.findByLabelText("journal.dialog.title");
  fireEvent.click(pickers()[1]);
  fireEvent.click(await screen.findByRole("option", { name: /Morning Run/ }));
  fireEvent.click(pickers()[0]);
  fireEvent.click(
    await screen.findByRole("option", { name: /^sportType\.Ride$/ }),
  );

  // The Ride plan Mark done would save can't take a run.
  expect(
    await screen.findByText("journal.dialog.noMatchingActivity"),
  ).toBeDefined();
});

it("preselects the sport of the last plan created", async () => {
  const created: string[] = [];
  const { Wrapper, queryClient } = createTestBackend({
    plannedTrainings: {
      list: () => [],
      create: ({ athleteId: _athleteId, ...fields }) => {
        created.push(fields.sportType);
        return { ...plan, ...fields };
      },
    },
  });
  onTestFinished(() => queryClient.clear());
  const onClose = vi.fn();
  const dialog = (
    <Wrapper>
      <ToastProvider>
        <PlannedTrainingDialog
          state={{ mode: "create", date: new Date(2026, 7, 10) }}
          onClose={onClose}
        />
      </ToastProvider>
    </Wrapper>
  );
  render(dialog);

  fireEvent.change(await screen.findByLabelText("journal.dialog.title"), {
    target: { value: "Tempo" },
  });
  fireEvent.click(pickers()[0]);
  fireEvent.click(
    await screen.findByRole("option", { name: /^sportType\.Run$/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "journal.dialog.create" }),
  );
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(created).toEqual(["Run"]);

  cleanup();
  render(dialog);
  await screen.findByLabelText("journal.dialog.title");
  expect(within(pickers()[0]).getByText("sportType.Run")).toBeDefined();
});

it("suggests past titles of the plan's sport and type, but not for a race", async () => {
  const ride = { ...activity, type: "Ride" };
  mockActivities = [
    { ...ride, id: 4, name: "Sweet spot 3x15", workoutType: 12 },
    // Older, same title: offered once.
    { ...ride, id: 5, name: "sweet spot 3x15", workoutType: 12 },
    // Not a workout.
    { ...ride, id: 6, name: "Morning Ride", workoutType: null },
    // Not a ride.
    { ...activity, id: 7, name: "Threshold 3x10", workoutType: 3 },
  ];
  const { Wrapper, queryClient } = createTestBackend({
    plannedTrainings: { list: () => [] },
  });
  onTestFinished(() => queryClient.clear());
  render(
    <Wrapper>
      <ToastProvider>
        <PlannedTrainingDialog
          // A new plan is a Ride workout by default.
          state={{ mode: "create", date: new Date(2026, 7, 10) }}
          onClose={vi.fn()}
        />
      </ToastProvider>
    </Wrapper>,
  );

  const title = await screen.findByRole("combobox", {
    name: "journal.dialog.title",
  });
  fireEvent.keyDown(title, { key: "ArrowDown" });
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual([
    "Sweet spot 3x15",
  ]);
  fireEvent.click(options[0]);
  expect((title as HTMLInputElement).value).toBe("Sweet spot 3x15");

  fireEvent.click(
    screen.getByRole("button", { name: "activities.edit.workout.race" }),
  );
  expect(
    screen.queryByRole("combobox", { name: "journal.dialog.title" }),
  ).toBeNull();
  expect(
    screen.getByRole<HTMLInputElement>("textbox", {
      name: "journal.dialog.title",
    }).value,
  ).toBe("Sweet spot 3x15");
});
