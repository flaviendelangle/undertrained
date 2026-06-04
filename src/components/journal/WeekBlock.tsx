import * as React from "react";

import { format } from "date-fns";
import type { Locale } from "date-fns";

import { useDroppable } from "@dnd-kit/react";
import type { PlannedTraining } from "@server/db/types";

import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";

import { TIER_STYLE, getLoadTier } from "./JournalDayCell";
import {
  WeekActivityBlock,
  WeekBusyBlock,
  WeekPlannedBlock,
  WeekPlannedBlockGhost,
} from "./WeekEventBlock";
import { useJournalPlanner } from "./journalPlanner";
import type { JournalDay, JournalWeek } from "./useJournalWeeks";
import {
  COMPACT_BLOCK_HEIGHT,
  HEADER_HEIGHT_PX,
  HOUR_HEIGHT,
  HOURS,
  MINUTES_PER_DAY,
  MINUTES_PER_PIXEL,
  MIN_BLOCK_HEIGHT,
  type PositionedEvent,
  buildBusyEvents,
  buildDayEvents,
  minutesToTimeLabel,
  packDayEvents,
  snapMinutes,
} from "./weekGrid";

const TOTAL_HEIGHT = (MINUTES_PER_DAY / 60) * HOUR_HEIGHT;

/** Live drop preview: which day and the snapped start minute, plus the training. */
export interface DropPreview {
  dayKey: string;
  minutes: number;
  training: PlannedTraining;
}

/** The snapped, full-opacity drop target shown in a day column while dragging. */
function PreviewGhost({ preview }: { preview: DropPreview }) {
  const durationMinutes = preview.training.durationSeconds / 60;
  const height = Math.max(
    MIN_BLOCK_HEIGHT,
    (durationMinutes / 60) * HOUR_HEIGHT,
  );
  return (
    <div
      className="pointer-events-none absolute right-0 left-0 z-20 pr-1.5"
      style={{ top: (preview.minutes / 60) * HOUR_HEIGHT, height }}
    >
      <WeekPlannedBlockGhost
        training={preview.training}
        time={minutesToTimeLabel(preview.minutes)}
        compact={height < COMPACT_BLOCK_HEIGHT}
      />
    </div>
  );
}

/**
 * One day's column in the time-grid: a drop target carrying its date, with
 * hour gridlines and the day's events positioned by time (overlaps packed
 * side-by-side). Activities render as solid blocks, planned trainings as
 * draggable dashed blocks.
 */
function DayColumn({
  date,
  positioned,
  busy,
  preview,
}: {
  date: Date;
  positioned: PositionedEvent[];
  /** Timed busy events, packed into their own behind-the-training back layer. */
  busy: PositionedEvent[];
  /** Snapped ghost shown while a drag hovers this day (null otherwise). */
  preview: DropPreview | null;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: format(date, "yyyy-MM-dd"),
  });
  const planner = useJournalPlanner();

  // Double-click an empty slot to plan a training on this day, prefilled to the
  // time under the cursor (snapped to the grid).
  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const top = e.currentTarget.getBoundingClientRect().top;
    const minutes = snapMinutes((e.clientY - top) * MINUTES_PER_PIXEL);
    const date2 = new Date(date);
    date2.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    planner?.onCreatePlanned(date2);
  };

  return (
    <div
      ref={ref}
      onDoubleClick={handleDoubleClick}
      className={cn(
        "border-border relative border-l transition-colors",
        isDropTarget && "bg-primary/5",
      )}
      style={{ height: TOTAL_HEIGHT }}
    >
      {HOURS.map((hour) => (
        <div
          key={hour}
          aria-hidden
          className={cn(
            "border-border/60 absolute inset-x-0",
            hour > 0 && "border-t",
          )}
          style={{ top: hour * HOUR_HEIGHT }}
        />
      ))}
      {/* Busy back layer: rendered before (and so behind) the training blocks,
          and click-through so empty-slot double-clicks still plan over them. */}
      {busy.map(({ event, top, height, leftPct, widthPct }) =>
        event.kind === "busy" ? (
          <div
            key={event.id}
            className="pointer-events-none absolute pr-1.5"
            style={{ top, height, left: `${leftPct}%`, width: `${widthPct}%` }}
          >
            <WeekBusyBlock
              busy={event.busy}
              compact={height < COMPACT_BLOCK_HEIGHT}
            />
          </div>
        ) : null,
      )}
      {preview != null && <PreviewGhost preview={preview} />}
      {positioned.map(({ event, top, height, leftPct, widthPct }) => (
        <div
          key={event.id}
          // Double-clicking an existing event shouldn't also open the planner.
          onDoubleClick={(e) => e.stopPropagation()}
          className="absolute pr-1.5"
          style={{
            top,
            height,
            left: `${leftPct}%`,
            width: `${widthPct}%`,
          }}
        >
          {event.kind === "activity" ? (
            <WeekActivityBlock
              activity={event.activity}
              compact={height < COMPACT_BLOCK_HEIGHT}
            />
          ) : event.kind === "planned" ? (
            <WeekPlannedBlock
              training={event.training}
              compact={height < COMPACT_BLOCK_HEIGHT}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** A single day cell in the sticky header strip (day name + date circle). */
function DayHeader({
  day,
  dateLocale,
}: {
  day: JournalDay;
  dateLocale: Locale;
}) {
  const localeOptions = { locale: dateLocale };
  return (
    <div className="border-border flex flex-col items-center justify-center gap-1 border-l py-2">
      <span
        className={cn(
          "text-[10px] font-medium tracking-wide uppercase",
          day.isToday ? "text-primary" : "text-muted-foreground",
        )}
      >
        {format(day.date, "EEE", localeOptions)}
      </span>
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
          day.isToday
            ? "bg-primary text-primary-foreground"
            : "text-foreground",
        )}
      >
        {format(day.date, "d")}
      </span>
    </div>
  );
}

/**
 * One day's cell in the all-day strip: date-only busy events as full-width muted
 * bars (availability hints only, never training). Only the first all-day event of
 * the day is shown for now — the strip is sized for a single bar, so stacking
 * several would overflow it. A multi-day event repeats per day, so the dot +
 * label show only on its first visible day — the matching fill on adjacent days
 * then reads as one continuous bar spanning the span. The continuation check uses
 * each day's *first* all-day event too, so a span keeps its label even when an
 * earlier day's slot is taken by another event.
 */
function AllDayCell({
  day,
  prevDay,
}: {
  day: JournalDay;
  /** The day to the left, used to detect a multi-day span's continuation. */
  prevDay: JournalDay | undefined;
}) {
  const t = useT();
  const busy = day.busyEvents.find((event) => event.allDay);
  const prevBusy = prevDay?.busyEvents.find((event) => event.allDay);
  const label = busy ? busy.title || t("journal.calendars.busy") : "";
  const continues =
    busy != null &&
    prevBusy != null &&
    prevBusy.subscriptionId === busy.subscriptionId &&
    prevBusy.title === busy.title;
  return (
    <div className="border-border flex flex-col justify-start gap-0.5 overflow-hidden border-l px-0.5 py-1">
      {busy != null && (
        <span
          title={label}
          style={{
            backgroundColor: `color-mix(in oklab, ${busy.color} 22%, var(--background))`,
          }}
          className="text-foreground/85 flex h-4 w-full items-center gap-1 overflow-hidden rounded-[3px] px-1.5 text-[11px] leading-none font-medium"
        >
          {!continues && (
            <>
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: busy.color }}
              />
              <span className="truncate">{label}</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * One week's content — a sticky-top day-header strip plus 7 {@link DayColumn}s.
 * Positioned absolutely by the parent (`JournalWeekView`) at a horizontal slot
 * the virtualizer assigned to its week.
 */
export function WeekBlock({
  week,
  dayLoadScale,
  allDayRowHeight,
  preview,
  dateLocale,
  style,
}: {
  week: JournalWeek;
  /** Reference busy day used to bucket each day into a load-intensity tier. */
  dayLoadScale: number;
  /**
   * Height of the all-day strip below the header, or `0` when the loaded range
   * has no all-day events (so the strip is reserved only when it's needed). Kept
   * in lock-step with the gutter spacer in {@link JournalWeekView}.
   */
  allDayRowHeight: number;
  /** Drop preview from the parent; only matches a day in this week is shown. */
  preview: DropPreview | null;
  dateLocale: Locale;
  style: React.CSSProperties;
}) {
  // Per-week packing: only runs for the ~3 weeks the virtualizer keeps mounted.
  const dayEvents = React.useMemo(
    () => week.days.map((day) => packDayEvents(buildDayEvents(day))),
    [week],
  );
  // Busy events pack in a separate layer so they never narrow the training
  // blocks — they sit full-width behind them.
  const dayBusyEvents = React.useMemo(
    () => week.days.map((day) => packDayEvents(buildBusyEvents(day))),
    [week],
  );
  const t = useT();

  const hasAllDayRow = allDayRowHeight > 0;

  return (
    <div style={style}>
      {/* Header + all-day strip pin together as one sticky block, so the all-day
          row stays visible right under the day names while the grid scrolls. The
          header keeps the accent background; the all-day row takes the grid's
          background so it reads as the first row of the columns below it. */}
      <div className="sticky top-0 z-30">
        <div
          className={cn(
            "bg-accent border-border relative grid grid-cols-7",
            !hasAllDayRow && "border-b",
          )}
          style={{ height: HEADER_HEIGHT_PX }}
        >
          {/* Per-day load-tier stripe spanning the top of the header, split into
              7 segments aligned with the day columns below. Empty days render a
              transparent slot so the grid stays continuous. */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 z-10 grid h-1 grid-cols-7"
          >
            {week.days.map((day) => {
              const tier = getLoadTier(day.totalLoad, dayLoadScale);
              return (
                <span
                  key={day.date.toISOString()}
                  title={
                    tier !== "none"
                      ? t("journal.tierLoad", {
                          tier: t(`journal.tier.${tier}`),
                          load: Math.round(day.totalLoad),
                        })
                      : undefined
                  }
                  className={cn(tier !== "none" && TIER_STYLE[tier].bar)}
                />
              );
            })}
          </div>
          {week.days.map((day) => (
            <DayHeader
              key={day.date.toISOString()}
              day={day}
              dateLocale={dateLocale}
            />
          ))}
        </div>
        {hasAllDayRow && (
          <div
            className="bg-background border-border grid grid-cols-7 border-b"
            style={{ height: allDayRowHeight }}
          >
            {week.days.map((day, index) => (
              <AllDayCell
                key={day.date.toISOString()}
                day={day}
                prevDay={week.days[index - 1]}
              />
            ))}
          </div>
        )}
      </div>
      <div
        className="grid grid-cols-7"
        style={{ height: TOTAL_HEIGHT }}
      >
        {week.days.map((day, index) => {
          const dayKey = format(day.date, "yyyy-MM-dd");
          return (
            <DayColumn
              key={day.date.toISOString()}
              date={day.date}
              positioned={dayEvents[index]}
              busy={dayBusyEvents[index]}
              preview={preview?.dayKey === dayKey ? preview : null}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Earliest event start (minutes since midnight) across this week, or `Infinity`. */
export function earliestMinutesOfWeek(week: JournalWeek): number {
  let min = Infinity;
  for (const day of week.days) {
    for (const event of buildDayEvents(day)) {
      if (event.startMinutes < min) {
        min = event.startMinutes;
      }
    }
  }
  return min;
}
