// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { createTestBackend } from "~/utils/trpcTestBackend";

import { useRecordsExplorer } from "./useRecordsExplorer";

const router = {
  isReady: true,
  query: {},
  pathname: "/personal-bests",
  replace: vi.fn(),
};
vi.mock("next/router", () => ({ useRouter: () => router }));
vi.mock("~/i18n/useT", () => {
  const t = (key: string) => key;
  return { useT: () => t };
});
afterEach(cleanup);

it("reports a failed overview, which the default leaderboard waits on, and retries it", async () => {
  let overviewFails = true;
  const { Wrapper } = createTestBackend({
    records: {
      getOptions: () => ({
        hasCycling: true,
        hasCyclingPower: true,
        hasRunning: false,
        runDistances: [],
      }),
      getBestsOverview: () => {
        if (overviewFails) throw new Error("overview down");
        return {
          power: [{ key: 60, value: 900 }],
          speed: [],
          heartrate: [],
          runEfforts: [],
          distance: 0,
          duration: 0,
          load: 0,
          biggestClimb: null,
          totalElevation: null,
        };
      },
      getCyclingPowerLeaderboard: () => [
        {
          activityStravaId: 1,
          activityName: "short",
          activityStartDate: "2026-01-11T07:30:00Z",
          activityStartDateLocal: "2026-01-11T07:30:00Z",
          activityType: "Ride",
          value: 900,
        },
      ],
    },
  });
  const { result } = renderHook(useRecordsExplorer, { wrapper: Wrapper });

  await waitFor(() => expect(result.current.isError).toBe(true));

  overviewFails = false;
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  expect(result.current.isError).toBe(false);
});
