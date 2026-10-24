// @vitest-environment happy-dom
import type * as React from "react";

import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import type { PlannedTraining } from "@server/db/types";
import {
  act,
  cleanup,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";

import { ToastProvider } from "~/components/ui/toast";
import { trpc } from "~/utils/trpc";
import {
  type TestProcedures,
  createTestBackend,
} from "~/utils/trpcTestBackend";

import {
  useCreatePlannedTraining,
  useDeletePlannedTraining,
  useLinkedActivityIds,
  useMarkPlannedTrainingDone,
  useNewActivities,
  usePlannedTrainingList,
  useReschedulePlannedTraining,
} from "./plannedTrainings";

/**
 * The module's hooks against the real tRPC proxy and a real QueryClient, with
 * only the server swapped for an in-memory one. Each case asserts what a
 * component would see: the reads, after a write.
 */

const ATHLETE_ID = 7;
vi.mock("./useAthleteId", () => ({ useAthleteId: () => ATHLETE_ID }));

const plan = {
  id: 17,
  athlete: ATHLETE_ID,
  title: "Threshold intervals",
  plannedDate: "2026-08-10T18:00:00",
  durationSeconds: 90 * 60,
  sportType: "Ride",
  workoutChoice: "workout",
  status: "planned",
  structuredWorkoutId: null,
  linkedActivityId: null,
  createdAt: 1,
  updatedAt: 1,
} satisfies PlannedTraining;

const MOVED_TO = "2026-08-12T07:00:00";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderWithServer<T>(hook: () => T, procedures: TestProcedures) {
  const { Wrapper, queryClient } = createTestBackend(procedures);
  onTestFinished(() => queryClient.clear());
  return renderHook(hook, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <Wrapper>
        <ToastProvider>{children}</ToastProvider>
      </Wrapper>
    ),
  });
}

afterEach(cleanup);

const plannedDates = (list: { data?: PlannedTraining[] }) =>
  list.data?.map((training) => training.plannedDate);

describe("reschedule", () => {
  it("moves the plan in the list at once, then shows the server's row", async () => {
    const save = deferred();
    let plans: PlannedTraining[] = [plan];
    const { result } = renderWithServer(
      () => ({
        list: usePlannedTrainingList(),
        reschedule: useReschedulePlannedTraining(),
      }),
      {
        plannedTrainings: {
          list: () => plans,
          update: async ({ athleteId: _athleteId, id, ...fields }) => {
            await save.promise;
            plans = plans.map((training) =>
              training.id === id
                ? { ...training, ...fields, updatedAt: 2 }
                : training,
            );
          },
        },
      },
    );
    await waitFor(() => expect(result.current.list.data).toEqual([plan]));

    act(() => {
      expect(result.current.reschedule(plan, MOVED_TO)).toBe(true);
    });
    await waitFor(() =>
      expect(plannedDates(result.current.list)).toEqual([MOVED_TO]),
    );

    save.resolve();
    // `updatedAt` only changes on the server, so this is the refetched row:
    // the move kept the plan's title, duration and sport.
    await waitFor(() =>
      expect(result.current.list.data).toEqual([
        { ...plan, plannedDate: MOVED_TO, updatedAt: 2 },
      ]),
    );
  });

  it("puts the plan back, and says so, when the server refuses the move", async () => {
    const save = deferred();
    // The refetch that follows the failure never lands, so the old date can
    // only come from the rollback.
    let listCalls = 0;
    const { result } = renderWithServer(
      () => ({
        list: usePlannedTrainingList(),
        reschedule: useReschedulePlannedTraining(),
      }),
      {
        plannedTrainings: {
          list: () =>
            listCalls++ === 0 ? [plan] : new Promise<never>(() => undefined),
          update: () => save.promise,
        },
      },
    );
    await waitFor(() => expect(result.current.list.data).toEqual([plan]));
    const onSettled = vi.fn();

    act(() => {
      result.current.reschedule(plan, MOVED_TO, { onSettled });
    });
    await waitFor(() =>
      expect(plannedDates(result.current.list)).toEqual([MOVED_TO]),
    );

    save.reject(new Error("offline"));
    await waitFor(() =>
      expect(plannedDates(result.current.list)).toEqual([plan.plannedDate]),
    );
    expect(result.current.list.isFetching).toBe(true);
    expect(onSettled).toHaveBeenCalledOnce();
    // `All`: the toast's text is mirrored into a screen-reader announcement.
    expect(await screen.findAllByText("common.saveError")).not.toHaveLength(0);
  });
});

it("lists a created plan and drops a deleted one", async () => {
  let plans: PlannedTraining[] = [];
  const { result } = renderWithServer(
    () => ({
      list: usePlannedTrainingList(),
      create: useCreatePlannedTraining(),
      remove: useDeletePlannedTraining(),
    }),
    {
      plannedTrainings: {
        list: () => plans,
        create: ({ athleteId: _athleteId, ...fields }) => {
          plans = [{ ...plan, ...fields }];
          return plans[0];
        },
        delete: ({ id }) => {
          plans = plans.filter((training) => training.id !== id);
        },
      },
    },
  );
  await waitFor(() => expect(result.current.list.data).toEqual([]));

  act(() =>
    result.current.create.mutate({
      athleteId: ATHLETE_ID,
      title: plan.title,
      plannedDate: plan.plannedDate,
      durationSeconds: plan.durationSeconds,
      sportType: plan.sportType,
      workoutChoice: plan.workoutChoice,
    }),
  );
  await waitFor(() => expect(result.current.list.data).toEqual([plan]));

  act(() =>
    result.current.remove.mutate({ athleteId: ATHLETE_ID, id: plan.id }),
  );
  await waitFor(() => expect(result.current.list.data).toEqual([]));
});

it("refreshes the plans, the activities and both pickers' candidates once a plan is marked done", async () => {
  const ride = {
    id: 501,
    stravaId: 9001,
    type: "Ride",
    startDateLocal: "2026-08-10T18:05:00",
  };
  const rideName = (done: boolean) => (done ? plan.title : "Evening Ride");
  let done = false;
  const { result } = renderWithServer(
    () => ({
      plans: usePlannedTrainingList(),
      linked: useLinkedActivityIds(),
      newActivities: useNewActivities(),
      activities: trpc.activities.list.useQuery({ athleteId: ATHLETE_ID }),
      maps: trpc.activities.maps.useQuery({ athleteId: ATHLETE_ID }),
      markDone: useMarkPlannedTrainingDone(),
    }),
    {
      plannedTrainings: {
        list: () => (done ? [] : [plan]),
        linkedActivityIds: () => (done ? [ride.id] : []),
        newActivities: () => ({
          watermark: ride.id,
          activities: done
            ? []
            : [
                {
                  stravaId: ride.stravaId,
                  type: ride.type,
                  name: rideName(done),
                  startDateLocal: ride.startDateLocal,
                },
              ],
        }),
        markDone: () => {
          done = true;
        },
      },
      activities: {
        // Only the fields this test reads; the real row has dozens more.
        list: () =>
          ({ activities: [{ ...ride, name: rideName(done) }] }) as never,
        maps: () => [
          {
            ...ride,
            name: rideName(done),
            startDate: "2026-08-10T16:05:00Z",
            distance: 40_000,
            movingTime: 3600,
            totalElevationGain: 300,
            mapPolyline: "_p~iF~ps|U",
          },
        ],
      },
    },
  );
  await waitFor(() => {
    expect(result.current.activities.isSuccess).toBe(true);
    expect(result.current.maps.isSuccess).toBe(true);
    expect(result.current.newActivities.data?.activities).toHaveLength(1);
  });

  act(() =>
    result.current.markDone.mutate({
      athleteId: ATHLETE_ID,
      id: plan.id,
      stravaId: ride.stravaId,
    }),
  );

  await waitFor(() => {
    const current = result.current;
    expect(current.plans.data).toEqual([]);
    expect(current.linked.data).toEqual([ride.id]);
    expect(current.newActivities.data?.activities).toEqual([]);
    expect(current.activities.data?.activities[0].name).toBe(plan.title);
    expect(current.maps.data?.[0].name).toBe(plan.title);
  });
});
