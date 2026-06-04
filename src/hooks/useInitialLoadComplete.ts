import * as React from "react";

import { useIsFetching } from "@tanstack/react-query";

/**
 * Gates a page's first paint until it is ready to be shown all at once, then
 * latches `true` permanently (the overlay only ever covers the initial load;
 * later refetches from config changes don't bring it back).
 *
 * Readiness is two conditions:
 *  - `dependenciesReady` — the caller's prerequisites are in place. For a page
 *    of lazily-imported charts this is "all chart modules have loaded", which is
 *    the real long pole on SPA navigation where the data is already cached.
 *  - no *foreground* fetch is in flight — either every fetch has resolved (fresh
 *    load) or the data was served from cache (SPA navigation). Queries flagged
 *    `meta.background` (e.g. slow external-calendar feeds) are excluded, so the
 *    page reveals without waiting on them and their results stream in after.
 *
 * Keying off fetch *activity* alone is wrong: on a warm cache nothing fetches,
 * so a "wait for a fetch to finish" signal would only ever fire via the timeout.
 * Combining it with `dependenciesReady` makes the cached path reveal as soon as
 * the modules are in.
 *
 * The two-frame wait before latching lets a query that a just-mounted chart is
 * about to start bump `fetching` back up (cancelling the reveal), and gives the
 * populated cards a frame to paint so they don't pop in after the overlay lifts.
 *
 * The timeout is a backstop for a hung request, not the normal completion path.
 */
export function useInitialLoadComplete(
  dependenciesReady = true,
  timeoutMs = 10000,
): boolean {
  const fetching = useIsFetching({
    predicate: (query) => query.meta?.background !== true,
  });
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    if (done || !dependenciesReady || fetching > 0) {
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setDone(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [done, dependenciesReady, fetching]);

  React.useEffect(() => {
    if (done) {
      return;
    }
    const timeout = setTimeout(() => setDone(true), timeoutMs);
    return () => clearTimeout(timeout);
  }, [done, timeoutMs]);

  return done;
}
