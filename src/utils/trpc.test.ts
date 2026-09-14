import superjson from "superjson";
import { afterEach, expect, it, vi } from "vitest";

import type { AppRouter } from "@server/trpc/root";
import { type TRPCLink, createTRPCClient } from "@trpc/client";

const captured = vi.hoisted(() => ({
  config: undefined as undefined | (() => { links: TRPCLink<AppRouter>[] }),
}));
vi.mock("@trpc/next", () => ({
  createTRPCNext: (options: { config: typeof captured.config }) => {
    captured.config = options.config;
    return {};
  },
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
await import("./trpc");

afterEach(() => vi.unstubAllGlobals());

it("delivers essential batches while analytics, badges and calendar feeds are pending", async () => {
  const releases: (() => void)[] = [];
  const requests: URL[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    requests.push(url);
    const paths = url.pathname.split("/").at(-1)!.split(",");
    if (
      paths.some(
        (path) =>
          path.startsWith("analytics.") ||
          path === "records.getRecordHolders" ||
          path === "calendarSubscriptions.events",
      )
    ) {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    }
    const rows = paths.map(() => ({
      result: { data: superjson.serialize([]) },
    }));
    return new Response(
      JSON.stringify(url.searchParams.has("batch") ? rows : rows[0]),
      {
        headers: { "content-type": "application/json" },
      },
    );
  });
  const client = createTRPCClient<AppRouter>({
    links: captured.config!().links,
  });
  let secondaryFinished = false;
  const secondary = Promise.all([
    client.analytics.getPowerCurve.query({ athleteId: 7 }),
    client.records.getRecordHolders.query({ athleteId: 7 }),
    client.calendarSubscriptions.events.query({
      athleteId: 7,
      from: "2026-08-01T00:00:00",
      to: "2026-08-31T23:59:59",
    }),
  ]).then(() => {
    secondaryFinished = true;
  });
  await Promise.all([
    client.activities.list.query({ athleteId: 7 }),
    client.activities.filterOptions.query({ athleteId: 7 }),
  ]);
  expect(secondaryFinished).toBe(false);
  expect(requests).toHaveLength(4);
  expect(requests.filter((url) => url.searchParams.has("batch"))).toHaveLength(
    1,
  );
  expect(releases).toHaveLength(3);
  releases.forEach((release) => release());
  await secondary;
});
