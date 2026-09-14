import { signOut } from "next-auth/react";
import superjson from "superjson";

import type { AppRouter } from "@server/trpc/root";
import {
  TRPCClientError,
  httpBatchLink,
  httpLink,
  splitLink,
} from "@trpc/client";
import { createTRPCNext } from "@trpc/next";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  // SSR — use localhost
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

function isUnauthorized(error: unknown): boolean {
  return (
    error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED"
  );
}

function handleUnauthorized() {
  if (typeof window !== "undefined") {
    void signOut({ callbackUrl: "/login" });
  }
}

export const trpc = createTRPCNext<AppRouter>({
  config() {
    return {
      links: [
        splitLink({
          // Slow analytics and external feeds must not delay essential data in
          // the same batch. Each secondary request can finish independently.
          condition: (op) =>
            op.type === "query" &&
            (op.path.startsWith("analytics.") ||
              op.path === "records.getRecordHolders" ||
              op.path === "calendarSubscriptions.events"),
          true: httpLink({
            url: `${getBaseUrl()}/api/trpc`,
            transformer: superjson,
          }),
          false: httpBatchLink({
            url: `${getBaseUrl()}/api/trpc`,
            transformer: superjson,
          }),
        }),
      ],
      queryClientConfig: {
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // 5 minutes
            // Activity/analytics data is historical, not live — refetching every
            // time the window regains focus just triggers a storm of full-history
            // refetches with no user benefit.
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (isUnauthorized(error)) {
                handleUnauthorized();
                return false;
              }
              return failureCount < 3;
            },
          },
          mutations: {
            onError: (error) => {
              if (isUnauthorized(error)) {
                handleUnauthorized();
              }
            },
          },
        },
      },
    };
  },
  ssr: false,
  transformer: superjson,
});
