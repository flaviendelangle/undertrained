// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlannedTraining } from "@server/db/types";
import { renderHook } from "@testing-library/react";

interface UpdateVariables {
  id: number;
  plannedDate: string;
}

interface MutationContext {
  previous: PlannedTraining[] | undefined;
}

interface MutationOptions {
  onMutate: (variables: UpdateVariables) => Promise<MutationContext>;
  onError: (
    error: Error,
    variables: UpdateVariables,
    context: MutationContext,
  ) => void;
  onSettled: () => void;
}

let cache: PlannedTraining[] = [];
let optimisticSnapshot: PlannedTraining[] = [];
let mutationDone: Promise<void> = Promise.resolve();
let mutationOptions: MutationOptions | null = null;

const cancel = vi.fn(() => Promise.resolve());
const invalidate = vi.fn(() => Promise.resolve());
const setData = vi.fn(
  (
    _input: { athleteId: number },
    update:
      | PlannedTraining[]
      | ((old: PlannedTraining[] | undefined) => PlannedTraining[] | undefined),
  ) => {
    const next = typeof update === "function" ? update(cache) : update;
    cache = next ?? [];
  },
);
const showErrorToast = vi.fn();

vi.mock("./useAthleteId", () => ({ useAthleteId: () => 7 }));
vi.mock("~/i18n/useT", () => ({ useT: () => (key: string) => key }));
vi.mock("~/components/ui/toast", () => ({ showErrorToast }));
vi.mock("~/utils/trpc", () => ({
  trpc: {
    useUtils: () => ({
      plannedTrainings: {
        list: {
          cancel,
          getData: () => cache,
          setData,
          invalidate,
        },
      },
    }),
    plannedTrainings: {
      update: {
        useMutation: (options: MutationOptions) => {
          mutationOptions = options;
          return {
            mutate: (
              variables: UpdateVariables,
              callbacks?: { onSettled?: () => void },
            ) => {
              mutationDone = (async () => {
                const context = await options.onMutate(variables);
                optimisticSnapshot = cache.map((training) => ({ ...training }));
                options.onError(
                  new Error("network failure"),
                  variables,
                  context,
                );
                options.onSettled();
                callbacks?.onSettled?.();
              })();
            },
          };
        },
      },
    },
  },
}));

const { useReschedulePlannedTraining } =
  await import("./useReschedulePlannedTraining");

const multiDayTraining = {
  id: 17,
  athlete: 7,
  title: "Stage simulation",
  plannedDate: "2026-08-10T18:00:00",
  durationSeconds: 40 * 60 * 60,
  sportType: "Ride",
  status: "planned",
  structuredWorkoutId: null,
  linkedActivityId: null,
  createdAt: 1,
  updatedAt: 1,
} satisfies PlannedTraining;

beforeEach(() => {
  cache = [multiDayTraining];
  optimisticSnapshot = [];
  mutationDone = Promise.resolve();
  mutationOptions = null;
  vi.clearAllMocks();
});

describe("useReschedulePlannedTraining", () => {
  it("rolls back an optimistic multi-day move when the mutation fails", async () => {
    const onSettled = vi.fn();
    const { result } = renderHook(() => useReschedulePlannedTraining());

    expect(mutationOptions).not.toBeNull();
    expect(
      result.current(multiDayTraining, "2026-08-16T10:00:00", { onSettled }),
    ).toBe(true);
    await mutationDone;

    expect(optimisticSnapshot[0]?.plannedDate).toBe("2026-08-16T10:00:00");
    expect(cache).toEqual([multiDayTraining]);
    expect(showErrorToast).toHaveBeenCalledWith("common.saveError");
    expect(invalidate).toHaveBeenCalledOnce();
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
