import * as React from "react";

import { useRouter } from "next/router";

import { useValueAsRef } from "@base-ui/utils/useValueAsRef";

import { type TimelineState, readTimelineState } from "./timelineState";

/**
 * URL snapshots let activity links and browser Back restore this inspection.
 * A new selection resets the period, sport and zoom, unless browser history
 * restored a snapshot taken with that selection.
 */
export function useTimelineState(selectionKey: string) {
  const router = useRouter();
  const [state, setState] = React.useState(() =>
    readTimelineState(router.query.timeline),
  );
  const currentRef = React.useRef(state);
  const routerRef = useValueAsRef(router);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Next may render a history entry before or after `popstate` reaches us, so
  // recognise a restored snapshot by the selection it was taken with.
  const seenRef = React.useRef(new Set<string>());
  const selectionRef = React.useRef(selectionKey);

  const persist = React.useCallback(
    (snapshot: TimelineState) => {
      const route = routerRef.current;
      // `update` already skips unchanged state. Comparing with `route.query`
      // would be wrong: it lags behind a replace that is still in flight.
      if (route.pathname !== "/activities/charts") return;
      const serialized = JSON.stringify(snapshot);
      seenRef.current.add(`${selectionRef.current}\n${serialized}`);
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

  const urlTimeline = router.query.timeline;
  React.useEffect(() => {
    const seen = `${selectionKey}\n${String(urlTimeline)}`;
    if (selectionRef.current === selectionKey) {
      seenRef.current.add(seen);
      return;
    }
    selectionRef.current = selectionKey;
    if (seenRef.current.has(seen)) {
      const snapshot = readTimelineState(urlTimeline);
      currentRef.current = snapshot;
      setState(snapshot);
    } else update({ period: undefined, sport: undefined, zoom: undefined });
  }, [selectionKey, urlTimeline, update]);

  const url = new URL(router.asPath, "https://app.invalid");
  url.searchParams.set("timeline", JSON.stringify(state));
  return { state, update, returnHref: url.pathname + url.search };
}
