import type * as React from "react";

import type { AppRouter } from "@server/trpc/root";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { observable } from "@trpc/server/observable";

type Inputs = inferRouterInputs<AppRouter>;
type Outputs = inferRouterOutputs<AppRouter>;

/**
 * What the server answers in a test, per procedure and keyed like the router:
 * `{ plannedTrainings: { list: (input) => [...] } }`. A call to a procedure
 * that has no answer fails, so a test can't pass on a request it didn't plan.
 */
export type TestProcedures = {
  [R in keyof Inputs]?: {
    [P in keyof Inputs[R] & keyof Outputs[R]]?: (
      input: Inputs[R][P],
    ) => Outputs[R][P] | Promise<Outputs[R][P]>;
  };
};

type AnyProcedure = (input: unknown) => unknown;

/**
 * Terminates the link chain in memory, where the app's `httpBatchLink` would
 * cross the network. Inputs and outputs are copied on the way through, as the
 * wire would, so a test's server state never shares objects with the cache.
 */
function memoryLink(procedures: TestProcedures): TRPCLink<AppRouter> {
  const byPath = procedures as Record<
    string,
    Record<string, AnyProcedure | undefined> | undefined
  >;
  return () =>
    ({ op }) =>
      observable((observer) => {
        const [router, name] = op.path.split(".");
        const procedure = byPath[router]?.[name];
        let active = true;
        void (async () => {
          try {
            if (procedure == null) {
              throw new Error(`The test has no answer for ${op.path}`);
            }
            const data = await procedure(structuredClone(op.input));
            if (active) {
              observer.next({ result: { data: structuredClone(data) } });
              observer.complete();
            }
          } catch (cause) {
            if (active) {
              observer.error(
                TRPCClientError.from(
                  cause instanceof Error ? cause : new Error(String(cause)),
                ),
              );
            }
          }
        })();
        return () => {
          active = false;
        };
      });
}

const testHooks = createTRPCReact<AppRouter>();

/**
 * A provider for rendering the app's hooks against `procedures` instead of the
 * server. The hooks keep using the real `trpc` proxy, which reads its client
 * from the same tRPC context, so query keys, cache writes and refetches are
 * tRPC's and React Query's own rather than a mock's.
 */
export function createTestBackend(procedures: TestProcedures) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client = testHooks.createClient({ links: [memoryLink(procedures)] });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <testHooks.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </testHooks.Provider>
    );
  }

  return { Wrapper, queryClient };
}
