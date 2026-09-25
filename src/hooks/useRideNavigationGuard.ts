import { useEffect, useRef, useState } from "react";

import { useRouter } from "next/router";

// Track history positions across the app so cancelling Back or Forward restores
// the original entry instead of replacing an unrelated page in browser history.
const POSITION = "undertrainedPosition";
function historyPosition(fallback = 0): number {
  const state = history.state as Record<string, unknown> | null;
  return typeof state?.[POSITION] === "number" ? state[POSITION] : fallback;
}
function historyData(data: unknown): Record<string, unknown> {
  return data != null && typeof data === "object"
    ? (data as Record<string, unknown>)
    : {};
}
export function useNavigationHistory() {
  useEffect(() => {
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    replace.call(
      history,
      { ...historyData(history.state), [POSITION]: historyPosition() },
      "",
    );
    history.pushState = function (data, unused, url) {
      push.call(
        this,
        { ...historyData(data), [POSITION]: historyPosition() + 1 },
        unused,
        url,
      );
    };
    history.replaceState = function (data, unused, url) {
      replace.call(
        this,
        { ...historyData(data), [POSITION]: historyPosition() },
        unused,
        url,
      );
    };
    return () => {
      history.pushState = push;
      history.replaceState = replace;
    };
  }, []);
}

export function useRideNavigationGuard(enabled: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const bypass = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const position = historyPosition();
    let restoring = false;
    let afterRestore: (() => void) | null = null;
    const cancelled = Object.assign(new Error("Ride navigation cancelled"), {
      cancelled: true,
    });
    const request = (go: () => void) => setPending(() => go);
    const onRoute = (url: string, options: { shallow: boolean }) => {
      if (bypass.current || url === router.asPath) return;
      request(() => {
        void router.push(url, undefined, options);
      });
      router.events.emit("routeChangeError", cancelled, url, options);
      throw cancelled;
    };
    // Next Link does not catch a synchronous routeChangeStart cancellation.
    const onRejection = (event: PromiseRejectionEvent) => {
      if (event.reason === cancelled) event.preventDefault();
    };
    router.beforePopState(() => {
      if (restoring) {
        restoring = false;
        afterRestore?.();
        afterRestore = null;
        return false;
      }
      if (bypass.current) return true;
      const target = historyPosition(position - 1);
      const delta = target - position;
      if (!delta) return true;
      restoring = true;
      history.go(-delta);
      request(() => {
        if (restoring) afterRestore = () => history.go(delta);
        else history.go(delta);
      });
      return false;
    });
    const onClick = (event: MouseEvent) => {
      if (
        bypass.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self")
      )
        return;
      if (link.href === location.href) return;
      event.preventDefault();
      event.stopPropagation();
      const url = new URL(link.href);
      request(() => {
        if (url.origin === location.origin)
          void router.push(url.pathname + url.search + url.hash);
        else location.assign(url.href);
      });
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (!bypass.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("unhandledrejection", onRejection);
    router.events.on("routeChangeStart", onRoute);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("unhandledrejection", onRejection);
      router.events.off("routeChangeStart", onRoute);
      router.beforePopState(() => true);
    };
  }, [enabled, router]);
  return {
    open: pending != null,
    cancel: () => setPending(null),
    proceed: () => {
      if (!pending) return;
      bypass.current = true;
      setPending(null);
      pending();
    },
  };
}
