// @vitest-environment happy-dom
import type { ReactNode } from "react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";

import { useInitialLoadComplete } from "./useInitialLoadComplete";

let client: QueryClient;
const key = (path: string) => [path.split("."), { type: "query" }];
const paths = ["activities.list"];
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
async function frames() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
}
function pending(path: string) {
  let resolve!: (value: string[]) => void;
  const promise = new Promise<string[]>((done) => {
    resolve = done;
  });
  void client
    .fetchQuery({ queryKey: key(path), queryFn: () => promise })
    .catch(() => undefined);
  return resolve;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    setTimeout(() => fn(0), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("initial page readiness", () => {
  it("waits for essential data but reveals while optional requests are still pending", async () => {
    const resolve = pending("activities.list");
    pending("records.getRecordHolders");
    pending("analytics.getPowerCurve");
    const { result } = renderHook(
      () => useInitialLoadComplete(true, 10000, paths),
      { wrapper },
    );
    await frames();
    expect(result.current).toBe(false);
    await act(async () => {
      resolve([]);
    });
    await frames();
    expect(result.current).toBe(true);
    expect(client.isFetching()).toBe(2);
  });

  it("reveals cached data during a refetch, after modules are ready", async () => {
    client.setQueryData(key("activities.list"), []);
    pending("activities.list");
    const { result, rerender } = renderHook(
      ({ ready }) => useInitialLoadComplete(ready, 10000, paths),
      { wrapper, initialProps: { ready: false } },
    );
    await frames();
    expect(result.current).toBe(false);
    rerender({ ready: true });
    await frames();
    expect(result.current).toBe(true);
    expect(client.isFetching()).toBe(1);
  });

  it("does not cover the page again on a later uncached query", async () => {
    const { result } = renderHook(
      () => useInitialLoadComplete(true, 10000, paths),
      { wrapper },
    );
    await frames();
    expect(result.current).toBe(true);
    act(() => {
      pending("activities.list");
    });
    await frames();
    expect(result.current).toBe(true);
  });

  it("retains the timeout for a hung essential request", async () => {
    pending("activities.list");
    const { result } = renderHook(
      () => useInitialLoadComplete(true, 1000, paths),
      { wrapper },
    );
    await frames();
    expect(result.current).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current).toBe(true);
  });
});
