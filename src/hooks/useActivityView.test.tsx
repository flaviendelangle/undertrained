// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { cleanup, renderHook } from "@testing-library/react";

import { ActivityViewProvider, useActivityView } from "./useActivityView";

const router = vi.hoisted(() => ({
  pathname: "/activities",
  query: { rules: "{", tab: "x" },
  isReady: true,
}));
vi.mock("next/router", () => ({ useRouter: () => router }));
vi.mock("./useAthleteId", () => ({ useAthleteId: () => 1 }));
vi.mock("~/utils/trpc", () => {
  const query = { useQuery: () => ({ data: [], isError: false }) };
  return { trpc: { views: { list: query, listFolders: query } } };
});
afterEach(cleanup);

it("keeps an invalid selection invalid when switching presentation", () => {
  const { result } = renderHook(useActivityView, {
    wrapper: ActivityViewProvider,
  });
  expect(result.current.error).toBe("views.errors.invalid");
  expect(result.current.href("/activities/map")).toBe(
    "/activities/map?rules=%7B",
  );
});
