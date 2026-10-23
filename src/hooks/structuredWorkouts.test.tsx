// @vitest-environment happy-dom
import { afterEach, expect, it, onTestFinished, vi } from "vitest";

import type {
  ListStructuredWorkout,
  StructuredWorkoutRow,
} from "@server/db/types";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import {
  STRUCTURED_WORKOUT_SCHEMA_VERSION,
  structuredWorkoutSchema,
} from "~/utils/structuredWorkout";
import {
  type TestProcedures,
  createTestBackend,
} from "~/utils/trpcTestBackend";

import {
  useCreateStructuredWorkout,
  useDeleteStructuredWorkout,
  useDuplicateStructuredWorkout,
  useStructuredWorkout,
  useStructuredWorkoutList,
  useUpdateStructuredWorkout,
} from "./structuredWorkouts";

/**
 * The module's hooks against the real tRPC proxy and a real QueryClient, with
 * only the server swapped for an in-memory one. A "reader that mounts later" is
 * the editor or the ride page opened after a write: what it renders first is
 * what the editor seeds its undo history from.
 */

const ATHLETE_ID = 7;
vi.mock("./useAthleteId", () => ({ useAthleteId: () => ATHLETE_ID }));

const workout = {
  id: 3,
  athlete: ATHLETE_ID,
  name: "Sweet spot",
  description: null,
  sport: "bike",
  structure: {
    version: STRUCTURED_WORKOUT_SCHEMA_VERSION,
    sport: "bike",
    nodes: [
      {
        id: "a",
        type: "step",
        durationSeconds: 600,
        power: { kind: "pct", pct: 0.88 },
      },
    ],
  },
  durationSeconds: 600,
  estimatedTss: null,
  ftpAtSave: null,
  createdAt: 1,
  updatedAt: 1,
} satisfies StructuredWorkoutRow;

const listed = ({
  structure: _structure,
  description: _description,
  ...rest
}: StructuredWorkoutRow): ListStructuredWorkout => ({
  ...rest,
  profile: [],
  summary: "",
});

/** The row a create or an update stores. */
function stored(
  id: number,
  fields: { name: string; description?: string | null; structure: unknown },
  updatedAt: number,
): StructuredWorkoutRow {
  return {
    ...workout,
    id,
    name: fields.name,
    description: fields.description ?? null,
    structure: structuredWorkoutSchema.parse(fields.structure),
    updatedAt,
  };
}

/** An in-memory library, plus a switch that leaves `get` hanging. */
function library(rows: StructuredWorkoutRow[]) {
  const state = { rows, getHangs: false };
  const procedures: TestProcedures = {
    structuredWorkouts: {
      list: () => state.rows.map(listed),
      get: ({ id }) => {
        if (state.getHangs) {
          return new Promise<never>(() => undefined);
        }
        const row = state.rows.find((candidate) => candidate.id === id);
        if (row == null) {
          throw new Error("Workout not found");
        }
        return row;
      },
      create: (fields) => {
        const row = stored(100 + state.rows.length, fields, 1);
        state.rows = [...state.rows, row];
        return row;
      },
      duplicate: ({ id, name }) => {
        const source = state.rows.find((candidate) => candidate.id === id)!;
        const row = { ...source, name, id: 100 + state.rows.length };
        state.rows = [...state.rows, row];
        return row;
      },
      update: (fields) => {
        const row = stored(fields.id, fields, 2);
        state.rows = state.rows.map((candidate) =>
          candidate.id === row.id ? row : candidate,
        );
        return row;
      },
      delete: ({ id }) => {
        state.rows = state.rows.filter((candidate) => candidate.id !== id);
      },
    },
  };
  const { Wrapper, queryClient } = createTestBackend(procedures);
  onTestFinished(() => queryClient.clear());
  const render = <T,>(hook: () => T) => renderHook(hook, { wrapper: Wrapper });
  return { state, render };
}

afterEach(cleanup);

it("hands the saved version to the library and to a reader that mounts later", async () => {
  const server = library([workout]);
  const page = server.render(() => ({
    list: useStructuredWorkoutList(),
    detail: useStructuredWorkout(workout.id),
    update: useUpdateStructuredWorkout(),
  }));
  await waitFor(() => expect(page.result.current.detail.data).toEqual(workout));
  // From here `get` never answers, so readers show only what the cache holds.
  server.state.getHangs = true;

  act(() =>
    page.result.current.update.mutate({
      athleteId: ATHLETE_ID,
      id: workout.id,
      name: "Sweet spot, longer",
      sport: "bike",
      structure: workout.structure,
    }),
  );
  await waitFor(() => {
    expect(page.result.current.detail.data?.name).toBe("Sweet spot, longer");
    expect(page.result.current.list.data?.map((row) => row.name)).toEqual([
      "Sweet spot, longer",
    ]);
  });
  page.unmount();

  const editor = server.render(() => useStructuredWorkout(workout.id));
  expect(editor.result.current.data?.name).toBe("Sweet spot, longer");
});

it("leaves no cached copy of a deleted workout for a reader that mounts later", async () => {
  const server = library([workout]);
  const editor = server.render(() => useStructuredWorkout(workout.id));
  await waitFor(() => expect(editor.result.current.data).toEqual(workout));
  editor.unmount();

  const page = server.render(() => ({
    list: useStructuredWorkoutList(),
    remove: useDeleteStructuredWorkout(),
  }));
  await waitFor(() => expect(page.result.current.list.data).toHaveLength(1));
  act(() =>
    page.result.current.remove.mutate({
      athleteId: ATHLETE_ID,
      id: workout.id,
    }),
  );
  await waitFor(() => expect(page.result.current.list.data).toEqual([]));

  const reopened = server.render(() => useStructuredWorkout(workout.id));
  expect(reopened.result.current.data).toBeUndefined();
  await waitFor(() => expect(reopened.result.current.isError).toBe(true));
});

it("lists a created and a duplicated workout", async () => {
  const server = library([]);
  const page = server.render(() => ({
    list: useStructuredWorkoutList(),
    create: useCreateStructuredWorkout(),
    duplicate: useDuplicateStructuredWorkout(),
  }));
  const names = () => page.result.current.list.data?.map((row) => row.name);
  await waitFor(() => expect(names()).toEqual([]));

  act(() =>
    page.result.current.create.mutate({
      athleteId: ATHLETE_ID,
      name: workout.name,
      sport: "bike",
      structure: workout.structure,
    }),
  );
  await waitFor(() => expect(names()).toEqual([workout.name]));

  act(() =>
    page.result.current.duplicate.mutate({
      athleteId: ATHLETE_ID,
      id: page.result.current.list.data![0].id,
      name: `${workout.name} (2)`,
    }),
  );
  await waitFor(() =>
    expect(names()).toEqual([workout.name, `${workout.name} (2)`]),
  );
});
