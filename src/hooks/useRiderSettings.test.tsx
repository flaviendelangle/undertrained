// @vitest-environment happy-dom
import type { ReactNode } from "react";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import {
  DEFAULT_RIDER_SETTINGS_TIMELINE,
  type RiderSettingsTimeline,
} from "~/sensors/types";

import {
  RiderSettingsProvider,
  useRiderSettingsTimeline,
} from "./useRiderSettings";

const backend = vi.hoisted(() => ({
  save: vi.fn(),
  stored: null as RiderSettingsTimeline | null,
}));
vi.mock("./useAthleteId", () => ({ useAthleteId: () => 1 }));
vi.mock("~/utils/trpc", async () => {
  const { useMutation, useQuery, useQueryClient } =
    await import("@tanstack/react-query");
  return {
    trpc: {
      riderSettings: {
        get: {
          useQuery: () =>
            useQuery({ queryKey: ["settings"], queryFn: () => backend.stored }),
        },
        save: {
          useMutation: (options: object) =>
            useMutation({ ...options, mutationFn: backend.save }),
        },
      },
      useUtils: () => {
        const client = useQueryClient();
        const noop = { invalidate: () => Promise.resolve() };
        return {
          riderSettings: {
            get: {
              invalidate: () =>
                client.invalidateQueries({ queryKey: ["settings"] }),
            },
          },
          activities: { list: noop, maps: noop },
          analytics: { getPowerCurve: noop, getPowerCurveYears: noop },
        };
      },
    },
  };
});
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <RiderSettingsProvider>{children}</RiderSettingsProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  backend.stored = DEFAULT_RIDER_SETTINGS_TIMELINE;
  backend.save.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it("keeps failed edits visible and retries the complete draft", async () => {
  backend.save
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(async (value: RiderSettingsTimeline) => {
      backend.stored = value;
    });
  const { result } = renderHook(useRiderSettingsTimeline, { wrapper });
  await waitFor(() => expect(result.current.hasSettings).toBe(true));
  const draft = { ...result.current.timeline, bikeWeightKg: 12 };
  act(() => result.current.setTimeline(draft));
  await waitFor(() => expect(result.current.saveStatus).toBe("error"));
  expect(result.current.timeline.bikeWeightKg).toBe(12);
  act(() => result.current.retrySave());
  await waitFor(() => expect(result.current.saveStatus).toBe("success"));
  expect(backend.save).toHaveBeenCalledTimes(2);
  expect(result.current.timeline.bikeWeightKg).toBe(12);
});

it("serializes rapid saves without replacing newer edits with an older response", async () => {
  const complete: (() => void)[] = [];
  backend.save.mockImplementation(
    (value: RiderSettingsTimeline) =>
      new Promise<void>((resolve) => {
        complete.push(() => {
          backend.stored = value;
          resolve();
        });
      }),
  );
  const { result } = renderHook(useRiderSettingsTimeline, { wrapper });
  await waitFor(() => expect(result.current.hasSettings).toBe(true));
  act(() =>
    result.current.setTimeline({
      ...result.current.timeline,
      bikeWeightKg: 10,
    }),
  );
  await waitFor(() => expect(backend.save).toHaveBeenCalledTimes(1));
  act(() =>
    result.current.setTimeline({ ...result.current.timeline, cdA: 0.4 }),
  );
  expect(result.current.timeline.bikeWeightKg).toBe(10);
  expect(result.current.timeline.cdA).toBe(0.4);
  expect(backend.save).toHaveBeenCalledTimes(1);
  await act(async () => complete[0]());
  await waitFor(() => expect(backend.save).toHaveBeenCalledTimes(2));
  expect(result.current.timeline.cdA).toBe(0.4);
  await act(async () => complete[1]());
  await waitFor(() => expect(result.current.saveStatus).toBe("success"));
  expect(result.current.timeline.bikeWeightKg).toBe(10);
  expect(result.current.timeline.cdA).toBe(0.4);
});

it("distinguishes a configured FTP from weight-only settings and the default", async () => {
  backend.stored = {
    ...DEFAULT_RIDER_SETTINGS_TIMELINE,
    initialValues: {
      ...DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues,
      ftp: null,
      weightKg: 75,
    },
    changes: [],
  };
  const { result } = renderHook(useRiderSettingsTimeline, { wrapper });
  await waitFor(() => expect(result.current.hasSettings).toBe(true));
  expect(result.current.currentSettings.ftp).toBe(200);
  expect(result.current.configuredFtp).toBeNull();
});

it("does not treat the fallback timeline as configured FTP before settings exist", async () => {
  backend.stored = null;
  const { result } = renderHook(useRiderSettingsTimeline, { wrapper });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(result.current.configuredFtp).toBeNull();
});
