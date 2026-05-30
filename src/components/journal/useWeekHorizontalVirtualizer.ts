import * as React from "react";

import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";

import { GUTTER_WIDTH_PX } from "./weekGrid";

/**
 * Drives the Week view's horizontal virtualizer over the loaded weeks. Tracks
 * the scroll container's width with a {@link ResizeObserver} so each rendered
 * week fills the visible area minus the sticky hour-axis gutter, and derives
 * the index of the most-visible week from the scroll offset.
 *
 * Returned `virtualizer` exposes the standard `scrollToIndex`, `measure`, and
 * `getVirtualItems` API — callers use it directly for programmatic scrolls and
 * for rendering the absolute-positioned week blocks.
 *
 * `pinnedIndex` (optional) keeps an extra item rendered outside the visible
 * range — used by callers about to jump there: with `scroll-snap-type: x
 * mandatory`, the snap engine smoothly snaps back to whichever week is in the
 * DOM if the target's snap-area isn't mounted at the moment the scroll lands,
 * so pre-rendering the target makes the snap a no-op.
 */
export function useWeekHorizontalVirtualizer({
  count,
  scrollRef,
  pinnedIndex,
}: {
  count: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  pinnedIndex?: number | null;
}) {
  const [containerWidth, setContainerWidth] = React.useState(0);

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  const weekWidth = Math.max(1, containerWidth - GUTTER_WIDTH_PX);

  const rangeExtractor = React.useCallback(
    (range: { startIndex: number; endIndex: number; overscan: number; count: number }) => {
      const indices = defaultRangeExtractor(range);
      if (
        pinnedIndex != null &&
        pinnedIndex >= 0 &&
        pinnedIndex < range.count &&
        !indices.includes(pinnedIndex)
      ) {
        const insertAt = indices.findIndex((i) => i > pinnedIndex);
        if (insertAt === -1) {
          indices.push(pinnedIndex);
        } else {
          indices.splice(insertAt, 0, pinnedIndex);
        }
      }
      return indices;
    },
    [pinnedIndex],
  );

  const virtualizer = useVirtualizer({
    horizontal: true,
    count,
    estimateSize: () => weekWidth,
    getScrollElement: () => scrollRef.current,
    overscan: 1,
    rangeExtractor,
  });

  // Tell the virtualizer to remeasure when the width changes, otherwise it
  // keeps positioning items at the old slot sizes after a window resize.
  React.useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, weekWidth]);

  const activeIndex =
    count === 0
      ? 0
      : Math.min(
          count - 1,
          Math.max(
            0,
            Math.round((virtualizer.scrollOffset ?? 0) / weekWidth),
          ),
        );

  return { virtualizer, weekWidth, containerWidth, activeIndex };
}
