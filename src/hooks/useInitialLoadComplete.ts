import * as React from "react";

import { useIsFetching } from "@tanstack/react-query";

/** Reveal once the page's essential queries and modules are ready. */
export function useInitialLoadComplete(
  dependenciesReady = true,
  timeoutMs = 10000,
  queryPaths?: readonly string[],
): boolean {
  const fetching = useIsFetching({
    predicate: (query) => {
      if (query.meta?.background === true || query.state.data !== undefined) {
        return false;
      }
      // tRPC query keys begin with an array of router/procedure path segments.
      const path = query.queryKey[0];
      return (
        !queryPaths ||
        (Array.isArray(path) && queryPaths.includes(path.join(".")))
      );
    },
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
