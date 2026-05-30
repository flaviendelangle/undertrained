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
  preview,
}: {
  date: Date;
  positioned: PositionedEvent[];
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
          ) : (
            <WeekPlannedBlock
              training={event.training}
              compact={height < COMPACT_BLOCK_HEIGHT}
            />
          )}
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
 * One week's content — a sticky-top day-header strip plus 7 {@link DayColumn}s.
 * Positioned absolutely by the parent (`JournalWeekView`) at a horizontal slot
 * the virtualizer assigned to its week.
 */
export function WeekBlock({
  week,
  dayLoadScale,
  preview,
  dateLocale,
  style,
}: {
  week: JournalWeek;
  /** Reference busy day used to bucket each day into a load-intensity tier. */
  dayLoadScale: number;
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
  const t = useT();

  return (
    <div style={style}>
      <div
        className="bg-accent border-border sticky top-0 z-30 grid grid-cols-7 border-b"
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
