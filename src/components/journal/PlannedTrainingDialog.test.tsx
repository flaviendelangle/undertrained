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
} from "@testing-library/react";

import { ToastProvider } from "~/components/ui/toast";
import { createTestBackend } from "~/utils/trpcTestBackend";

import { PlannedTrainingDialog } from "./PlannedTrainingDialog";

const ATHLETE_ID = 7;
vi.mock("~/hooks/useAthleteId", () => ({ useAthleteId: () => ATHLETE_ID }));

const activity = {
  id: 3,
  stravaId: 42,
  type: "Run",
  name: "Morning Run",
  startDateLocal: "2026-08-10T07:00:00",
};
vi.mock("~/hooks/useActivitiesQuery", () => ({
  useActivitiesQuery: () => ({ data: [activity] }),
}));

const plan = {
  id: 17,
  athlete: ATHLETE_ID,
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

afterEach(cleanup);

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
  // The second combobox: the first is the sport picker.
  fireEvent.click(screen.getAllByRole("combobox")[1]);
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

  fireEvent.click((await screen.findAllByRole("combobox"))[1]);
  fireEvent.click(await screen.findByRole("option", { name: /Morning Run/ }));
  fireEvent.click(screen.getAllByRole("combobox")[0]);
  fireEvent.click(
    await screen.findByRole("option", { name: /^sportType\.Ride$/ }),
  );

  // The Ride plan Mark done would save can't take a run.
  expect(
    await screen.findByText("journal.dialog.noMatchingActivity"),
  ).toBeDefined();
});
