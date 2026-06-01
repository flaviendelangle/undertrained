import * as React from "react";

import { addDays, format, isSameMonth } from "date-fns";
import { ChevronDownIcon } from "lucide-react";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { useValueAsRef } from "@base-ui/utils/useValueAsRef";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import {
  DragDropProvider,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
} from "@dnd-kit/react";
import type { PlannedTraining } from "@server/db/types";

import {
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
} from "~/components/ui/select";
import { useReschedulePlannedTraining } from "~/hooks/useReschedulePlannedTraining";
import { useLocale, useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";

import { WeekBlock, type DropPreview, earliestMinutesOfWeek } from "./WeekBlock";
import { buildWeekGroups } from "./journalView";
import type { JournalWeek } from "./useJournalWeeks";
import { useWeekHorizontalVirtualizer } from "./useWeekHorizontalVirtualizer";
import {
  GUTTER_WIDTH_PX,
  HEADER_HEIGHT_PX,
  HOUR_HEIGHT,
  HOURS,
  MINUTES_PER_DAY,
  MINUTES_PER_PIXEL,
  minutesToTimeLabel,
  snapMinutes,
} from "./weekGrid";

const TOTAL_HEIGHT = (MINUTES_PER_DAY / 60) * HOUR_HEIGHT;

/** Hour the grid scrolls to when the week has no events to anchor on. */
const DEFAULT_SCROLL_HOUR = 6;

/** Fallback URL-sync timeout when `scrollend` isn't supported (Safari < 17.4). */
const SCROLL_END_FALLBACK_MS = 150;

// Start a drag after a small move (no delay) so a click still opens the editor.
// `preventActivation: () => false` is essential here: the draggable is a
// `<button>`, and the sensor's default would refuse to start a drag whenever the
// press lands on an interactive element (which a button always is) — so the
// whole block, button included, stays draggable.
const SENSORS = [
  PointerSensor.configure({
    activationConstraints: [
      new PointerActivationConstraints.Distance({ value: 4 }),
    ],
    preventActivation: () => false,
  }),
  KeyboardSensor,
];

/** Matches a droppable id (`yyyy-MM-dd`). */
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The fixed left column of hour labels, aligned to the grid's hour lines. */
function TimeAxis() {
  return (
    <div className="relative" style={{ height: TOTAL_HEIGHT }}>
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="text-muted-foreground/70 absolute right-1.5 text-[10px] leading-none tabular-nums"
          style={{ top: hour * HOUR_HEIGHT - 4 }}
        >
          {hour === 0 ? "" : `${String(hour).padStart(2, "0")}:00`}
        </div>
      ))}
    </div>
  );
}

function JournalWeekViewImpl({
  week,
  weeks,
  dayLoadScale,
  scrollNonce,
  onSelectWeek,
}: {
  /** The anchor week (URL `?week=`); horizontal scroll mounts onto it. */
  week: JournalWeek;
  weeks: JournalWeek[];
  /** Reference busy day used to bucket each day into a load-intensity tier. */
  dayLoadScale: number;
  /** Bumped by the parent to request a (re)scroll to the anchor week. */
  scrollNonce: number;
  /** Navigate the URL to the given week's Monday (debounced via the parent). */
  onSelectWeek: (weekStart: Date) => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const reschedule = useReschedulePlannedTraining();
  const t = useT();
  const { dateLocale } = useLocale();
  const localeOptions = { locale: dateLocale };

  const renderedWeeks = React.useMemo(() => weeks.toReversed(), [weeks]);

  // `pinnedIndex`: the destination of an in-flight programmatic jump. Forces
  // the target week to render even when it falls outside the virtualizer's
  // normal range, so the mandatory scroll-snap engine can find its snap-area
  // at the landing position instead of smoothly snapping back to whichever
  // overscan item happens to be nearest in the DOM.
  const [pinnedIndex, setPinnedIndex] = React.useState<number | null>(null);
  const { virtualizer, weekWidth, containerWidth, activeIndex } =
    useWeekHorizontalVirtualizer({
      count: renderedWeeks.length,
      scrollRef,
      pinnedIndex,
    });

  // The week the picker label shows = whichever week the user has most centered
  // in the viewport, not the URL anchor (which only updates on scroll-stop).
  const activeWeek = renderedWeeks[activeIndex] ?? week;

  // Corner picker contents: every loaded week, newest first, grouped under its
  // month for scannability.
  const weekGroups = React.useMemo(() => buildWeekGroups(weeks), [weeks]);

  // Live ghost shown at the prospective drop slot (Google-Calendar style).
  const [preview, setPreview] = React.useState<DropPreview | null>(null);

  // All planned trainings by id, so a drag starting in a virtualized neighbour
  // week resolves regardless of which week the active anchor sits on. Cheap to
  // build — at most a few weeks worth of trainings.
  const trainingsById = React.useMemo(() => {
    const map = new Map<number, PlannedTraining>();
    for (const w of weeks) {
      for (const day of w.days) {
        for (const training of day.plannedTrainings) {
          map.set(training.id, training);
        }
      }
    }
    return map;
  }, [weeks]);

  // Resolve a drag operation to its target day + snapped start minute. The
  // draggable id is `planned-<id>` and the droppable (column) id is `yyyy-MM-dd`;
  // the new time is the original start plus the vertical drag delta, snapped.
  const resolveDrop = (operation: DragMoveEvent["operation"]) => {
    const { source, target } = operation;
    if (source == null || target == null) {
      return null;
    }
    const sourceId = String(source.id);
    const dayKey = String(target.id);
    if (!sourceId.startsWith("planned-") || !DAY_KEY_RE.test(dayKey)) {
      return null;
    }
    const trainingId = Number(sourceId.slice("planned-".length));
    const training = trainingsById.get(trainingId);
    if (training == null) {
      return null;
    }
    const originalMinutes =
      Number(training.plannedDate.slice(11, 13)) * 60 +
      Number(training.plannedDate.slice(14, 16));
    const minutes = snapMinutes(
      originalMinutes + (operation.transform?.y ?? 0) * MINUTES_PER_PIXEL,
    );
    return { dayKey, training, minutes };
  };

  const updatePreview = (operation: DragMoveEvent["operation"]) => {
    const drop = resolveDrop(operation);
    if (drop == null) {
      setPreview(null);
      return;
    }
    setPreview((prev) =>
      prev?.dayKey === drop.dayKey && prev?.minutes === drop.minutes
        ? prev
        : {
            dayKey: drop.dayKey,
            minutes: drop.minutes,
            training: drop.training,
          },
    );
  };

  const handleDragStart = (event: DragStartEvent) =>
    updatePreview(event.operation);
  const handleDragMove = (event: DragMoveEvent) =>
    updatePreview(event.operation);

  const handleDragEnd = (event: DragEndEvent) => {
    setPreview(null);
    if (event.canceled) {
      return;
    }
    const drop = resolveDrop(event.operation);
    if (drop == null) {
      return;
    }
    reschedule(
      drop.training,
      `${drop.dayKey}T${minutesToTimeLabel(drop.minutes)}:00`,
    );
  };

  // ---- Horizontal scroll: mount, resize, and explicit re-anchor ("Today") ----

  const anchorWeekTime = week.weekStart.getTime();

  // Two-phase jump. Calling `scrollToIndex` and `setPinnedIndex` in the same
  // synchronous block would be racy: with `scroll-snap-type: x mandatory` the
  // snap engine evaluates the moment `scrollLeft` changes, but the React
  // commit that mounts the pinned target hasn't run yet — so snap smoothly
  // reverts to whichever overscan item is in the DOM (initially `[0..2]`,
  // which is why the calendar slid to index 2). Splitting the work means:
  //   1. `jumpToWeek(n)` records the pending target in `pendingScrollTarget`.
  //   2. React re-renders with the target included in the virtualizer's range
  //      and commits the target's `WeekBlock` to the DOM.
  //   3. The `useLayoutEffect` below sees the new target, calls
  //      `scrollToIndex` (now snap-safe because the target is mounted), and
  //      registers a `scrollend` listener to drop the pin once the
  //      virtualizer's natural range has caught up.
  const [pendingScrollTarget, setPendingScrollTarget] = React.useState<
    number | null
  >(null);
  const jumpToWeek = React.useCallback((index: number) => {
    setPendingScrollTarget(index);
    setPinnedIndex(index);
  }, []);

  React.useLayoutEffect(() => {
    if (pendingScrollTarget == null) {
      return;
    }
    virtualizer.scrollToIndex(pendingScrollTarget, {
      align: "end",
      behavior: "instant",
    });
    setPendingScrollTarget(null);
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    const onScrollEnd = () => setPinnedIndex(null);
    scroller.addEventListener("scrollend", onScrollEnd, { once: true });
    return () => scroller.removeEventListener("scrollend", onScrollEnd);
  }, [pendingScrollTarget, virtualizer]);

  // On mount, land on the anchor week. Once the scroll has settled, open URL
  // reporting so the next sync comes from a genuine user scroll.
  const didInitialHorizontalScroll = React.useRef(false);
  const allowReport = React.useRef(false);
  // Baseline `weekWidth` the resize effect compares against. Seeded with the
  // dummy initial render value (before the container is measured) and rebased
  // to the measured value inside the initial-scroll effect — without that
  // rebase, the resize effect would fire in the same commit as the initial
  // scroll, see `weekWidth ≠ 1`, and re-anchor to `activeIndex=0` (scrollOffset
  // hasn't been updated yet), undoing the anchor we just set.
  const prevWeekWidth = React.useRef(weekWidth);
  React.useLayoutEffect(() => {
    if (didInitialHorizontalScroll.current) {
      return;
    }
    if (renderedWeeks.length === 0 || containerWidth === 0) {
      return;
    }
    didInitialHorizontalScroll.current = true;
    prevWeekWidth.current = weekWidth;
    const index = renderedWeeks.findIndex(
      (w) => w.weekStart.getTime() === anchorWeekTime,
    );
    if (index >= 0) {
      jumpToWeek(index);
    }
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        allowReport.current = true;
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, [renderedWeeks, anchorWeekTime, jumpToWeek, containerWidth, weekWidth]);

  // Re-anchor after a width change so the visible week stays glued under the
  // user's eye (otherwise a window resize visibly shifts the calendar).
  // Reads `el.scrollLeft` against the previous `weekWidth` to recover the
  // current week index — `activeIndex` (from `virtualizer.scrollOffset`) lags
  // here, since the virtualizer only updates on scroll events. On mount the
  // initial `jumpToWeek` synchronously sets `scrollLeft`, but the vertical
  // scrollbar appearing immediately afterwards re-fires `ResizeObserver`
  // before the scroll event lands, so this effect would otherwise see
  // `activeIndex=0` and yank the view back to today.
  React.useLayoutEffect(() => {
    if (!didInitialHorizontalScroll.current) {
      return;
    }
    const previousWeekWidth = prevWeekWidth.current;
    if (weekWidth === previousWeekWidth) {
      return;
    }
    prevWeekWidth.current = weekWidth;
    const el = scrollRef.current;
    if (!el || previousWeekWidth <= 0) {
      return;
    }
    const currentIndex = Math.round(el.scrollLeft / previousWeekWidth);
    virtualizer.scrollToIndex(currentIndex, { align: "end" });
  }, [weekWidth, virtualizer]);

  // Re-anchor the scroll to the URL week whenever its index in `renderedWeeks`
  // shifts. `useJournalWeeks` rebuilds the array when data trickles in
  // (activities and planned trainings are separate queries); an activity older
  // than anything we'd seen extends `renderedWeeks` at the front, pushing every
  // existing week — including the URL anchor — to a higher index. Without this
  // re-anchor the user's `scrollLeft = oldIndex * weekWidth` keeps pointing at
  // the slot that now holds a *different* week, looking exactly like the
  // calendar quietly slid away from the URL anchor. Future-planned trainings
  // extend `renderedWeeks` at the END, so they don't shift indices and this
  // effect no-ops for that case. Tracking `lastSyncedAnchorIndex` makes
  // user-scroll → URL-sync round-trips a no-op: the index matches what we last
  // synced to, so we don't fight a fresh scroll the user just made.
  const lastSyncedAnchorIndex = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    if (!didInitialHorizontalScroll.current) {
      return;
    }
    const index = renderedWeeks.findIndex(
      (w) => w.weekStart.getTime() === anchorWeekTime,
    );
    if (index < 0) {
      return;
    }
    if (index === lastSyncedAnchorIndex.current) {
      return;
    }
    const previous = lastSyncedAnchorIndex.current;
    lastSyncedAnchorIndex.current = index;
    // Initial-scroll path already landed on this index; just record it.
    if (previous == null) {
      return;
    }
    const el = scrollRef.current;
    if (el && Math.round(el.scrollLeft / weekWidth) === index) {
      return;
    }
    jumpToWeek(index);
  }, [renderedWeeks, anchorWeekTime, weekWidth, jumpToWeek]);

  // Re-scroll on explicit request (e.g. the "Today" menu item bumps the nonce);
  // the initial nonce is skipped so this never double-fires with the mount.
  const initialNonce = React.useRef(scrollNonce);
  React.useEffect(() => {
    if (scrollNonce === initialNonce.current || renderedWeeks.length === 0) {
      return;
    }
    const index = renderedWeeks.findIndex(
      (w) => w.weekStart.getTime() === anchorWeekTime,
    );
    if (index >= 0) {
      jumpToWeek(index);
    }
  }, [scrollNonce, renderedWeeks, anchorWeekTime, jumpToWeek]);

  // ---- Vertical scroll: only once on mount, not on every cross-week snap ----

  // Open the grid near the first event of the anchor week (or 06:00 if empty);
  // gated by a ref so cross-week scrolls preserve the user's vertical position.
  const earliestMinutes = React.useMemo(
    () => earliestMinutesOfWeek(week),
    [week],
  );
  const didInitialVerticalScroll = React.useRef(false);
  React.useLayoutEffect(() => {
    if (didInitialVerticalScroll.current) {
      return;
    }
    const scroller = scrollRef.current;
    if (!scroller || weeks.length === 0) {
      return;
    }
    didInitialVerticalScroll.current = true;
    const startMinutes = Number.isFinite(earliestMinutes)
      ? earliestMinutes
      : DEFAULT_SCROLL_HOUR * 60;
    const eventTop = (startMinutes / 60) * HOUR_HEIGHT;
    scroller.scrollTop = HEADER_HEIGHT_PX + Math.max(0, eventTop - HOUR_HEIGHT);
  }, [earliestMinutes, weeks.length]);

  // ---- URL sync: only after the user stops scrolling horizontally ----

  // `scrollend` fires once per scroll gesture (Chrome 114+, FF 109+, Safari
  // 17.4+); the 150 ms idle timer covers older browsers and lazy trackpad
  // settles where `scrollend` is delayed.
  const onSelectWeekRef = useValueAsRef(onSelectWeek);
  const renderedWeeksRef = useValueAsRef(renderedWeeks);
  const weekWidthRef = useValueAsRef(weekWidth);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    let timer: number | null = null;
    const fire = () => {
      if (!allowReport.current) {
        return;
      }
      const width = weekWidthRef.current;
      if (width <= 0) {
        return;
      }
      const list = renderedWeeksRef.current;
      const i = Math.min(
        list.length - 1,
        Math.max(0, Math.round(el.scrollLeft / width)),
      );
      const target = list[i]?.weekStart;
      if (target) {
        onSelectWeekRef.current(target);
      }
    };
    const onScroll = () => {
      if (timer != null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(fire, SCROLL_END_FALLBACK_MS);
    };
    const onScrollEnd = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
      fire();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", onScrollEnd);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", onScrollEnd);
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [onSelectWeekRef, renderedWeeksRef, weekWidthRef]);

  const totalSize = virtualizer.getTotalSize();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-auto",
          // Programmatic scrollToIndex glides; users who prefer reduced motion
          // get an instant jump.
          "motion-safe:[scroll-behavior:smooth]",
          // Snap one week per page so the view always rests on a clean week
          // boundary. Each WeekBlock is `scroll-snap-align: end`, so the snap
          // engine targets the right edge of the viewport — which has no
          // sticky obstruction, so no scroll-padding is needed.
          "[scroll-snap-type:x_mandatory]",
        )}
      >
        <DragDropProvider
          sensors={SENSORS}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
        >
          <div
            className="flex"
            style={{
              width: GUTTER_WIDTH_PX + totalSize,
              height: HEADER_HEIGHT_PX + TOTAL_HEIGHT,
            }}
          >
            {/* Left gutter: sticky-left pins the column. Inside, the week
                picker is sticky-top so it also pins to the corner; the time
                axis scrolls vertically with the body. The z-index sits above
                each WeekBlock's sticky day-header strip (z-30) so the corner
                picker stays on top; the opaque background keeps day columns
                of neighbour weeks from bleeding through during horizontal
                scroll. */}
            <div
              className="bg-background sticky left-0 z-40 shrink-0"
              style={{ width: GUTTER_WIDTH_PX }}
            >
              {/* `modal={false}`: a modal popup locks `<body>` scroll, which
                  swings the body width by the scrollbar gutter on open/close.
                  Here that swing propagates into our `clientWidth` and shifts
                  `weekWidth`, firing the resize re-anchor mid-scroll and
                  hijacking the click-triggered scroll to the in-flight
                  `activeIndex` instead of the picked week. */}
              <SelectPrimitive.Root
                modal={false}
                value={format(activeWeek.weekStart, "yyyy-MM-dd")}
                onValueChange={(value) => {
                  const targetIndex = renderedWeeks.findIndex(
                    (item) => format(item.weekStart, "yyyy-MM-dd") === value,
                  );
                  if (targetIndex >= 0) {
                    jumpToWeek(targetIndex);
                  }
                }}
              >
                <SelectPrimitive.Trigger
                  title={t("journal.jumpToWeek")}
                  className="bg-accent border-border hover:bg-background/60 sticky top-0 z-40 flex w-full cursor-pointer flex-col items-center justify-center gap-0.5 border-b transition-colors outline-none"
                  style={{ height: HEADER_HEIGHT_PX }}
                >
                  <span className="text-foreground flex items-center gap-0.5 text-[11px] leading-none font-semibold">
                    <SelectPrimitive.Value>
                      {() =>
                        format(activeWeek.weekStart, "'W'w", localeOptions)
                      }
                    </SelectPrimitive.Value>
                    <ChevronDownIcon className="size-3" />
                  </span>
                  <span className="text-muted-foreground text-[10px] leading-none tabular-nums">
                    {format(activeWeek.weekStart, "yyyy")}
                  </span>
                </SelectPrimitive.Trigger>
                <SelectContent align="start" className="max-h-80 w-52">
                  {weekGroups.map((group) => (
                    <SelectGroup key={group.month.toISOString()}>
                      <SelectLabel>
                        {format(group.month, "MMMM yyyy", localeOptions)}
                      </SelectLabel>
                      {group.weeks.map((item) => {
                        const end = addDays(item.weekStart, 6);
                        const range = isSameMonth(item.weekStart, end)
                          ? `${format(item.weekStart, "d")}–${format(end, "d MMM", localeOptions)}`
                          : `${format(item.weekStart, "d MMM", localeOptions)} – ${format(end, "d MMM", localeOptions)}`;
                        return (
                          <SelectItem
                            key={item.weekStart.toISOString()}
                            value={format(item.weekStart, "yyyy-MM-dd")}
                            className="tabular-nums"
                          >
                            <span>
                              {format(item.weekStart, "'W'w", localeOptions)}
                            </span>
                            <span className="text-muted-foreground ml-auto text-xs">
                              {range}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </SelectPrimitive.Root>
              <TimeAxis />
            </div>

            {/* Right: virtualized week blocks, each absolute-positioned at the
                slot the virtualizer assigned. */}
            <div
              style={{
                position: "relative",
                width: totalSize,
                height: HEADER_HEIGHT_PX + TOTAL_HEIGHT,
              }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const w = renderedWeeks[item.index];
                return (
                  <WeekBlock
                    key={w.weekStart.toISOString()}
                    week={w}
                    dayLoadScale={dayLoadScale}
                    preview={preview}
                    dateLocale={dateLocale}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: item.start,
                      width: item.size,
                      height: HEADER_HEIGHT_PX + TOTAL_HEIGHT,
                      scrollSnapAlign: "end",
                    }}
                  />
                );
              })}
            </div>
          </div>

          {/* Empty overlay: suppresses the floating drag clone (and its
              fly-back animation) so the dragged event simply dims in place
              while the snapped ghost shows the target. */}
          <DragOverlay dropAnimation={null}>{null}</DragOverlay>
        </DragDropProvider>
      </div>
    </div>
  );
}

export const JournalWeekView = React.memo(JournalWeekViewImpl);
