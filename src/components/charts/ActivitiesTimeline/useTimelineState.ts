import * as React from "react";

import { useRouter } from "next/router";

import { useValueAsRef } from "@base-ui/utils/useValueAsRef";

import { type TimelineState, readTimelineState } from "./timelineState";

/** URL snapshots let activity links and browser Back restore this inspection. */
export function useTimelineState() {
  const router = useRouter();
  const [state, setState] = React.useState(() =>
    readTimelineState(router.query.timeline),
  );
  const currentRef = React.useRef(state);
  const routerRef = useValueAsRef(router);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const persist = React.useCallback(
    (snapshot: TimelineState) => {
      const route = routerRef.current;
      const serialized = JSON.stringify(snapshot);
      if (
        route.pathname !== "/activities/charts" ||
        route.query.timeline === serialized
      )
        return;
      void route.replace(
        {
          pathname: route.pathname,
          query: { ...route.query, timeline: serialized },
        },
        undefined,
        { shallow: true, scroll: false },
      );
    },
    [routerRef],
  );

  const update = React.useCallback(
    (patch: Partial<TimelineState>, immediate = true) => {
      const next = { ...currentRef.current, ...patch };
      if (JSON.stringify(next) === JSON.stringify(currentRef.current)) return;
      currentRef.current = next;
      setState(next);
      clearTimeout(timerRef.current);
      // Only continuous slider movement is debounced. Never leave a delayed router
      // replace behind a discrete action or a link to another page.
      if (immediate) persist(next);
      else timerRef.current = setTimeout(() => persist(next), 150);
    },
    [persist],
  );

  React.useEffect(() => {
    const cancel = () => clearTimeout(timerRef.current);
    const restore = () => {
      cancel();
      const snapshot = readTimelineState(
        new URL(window.location.href).searchParams.get("timeline"),
      );
      currentRef.current = snapshot;
      setState(snapshot);
    };
    router.events.on("routeChangeStart", cancel);
    window.addEventListener("popstate", restore);
    return () => {
      cancel();
      router.events.off("routeChangeStart", cancel);
      window.removeEventListener("popstate", restore);
    };
  }, [router.events]);

  const url = new URL(router.asPath, "https://app.invalid");
  url.searchParams.set("timeline", JSON.stringify(state));
  return { state, update, returnHref: url.pathname + url.search };
}
