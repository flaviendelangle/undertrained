import * as React from "react";

import { format, isSameMonth } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";
import { CalendarClockIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import { JournalDayCell } from "./JournalDayCell";
import type { JournalWeek } from "./useJournalWeeks";

/** Fixed height of every week row, regardless of how many activities it holds. */
export const ROW_HEIGHT = 150;

/** Grid template shared by the header and the rows so columns stay aligned. */
export const JOURNAL_GRID_COLS =
  "grid-cols-[3rem_repeat(7,minmax(0,1fr))_5rem] md:grid-cols-[7rem_repeat(7,minmax(0,1fr))_7rem]";

const LOCALE_OPTIONS = { locale: enGB };

/** Compact non-wrapping duration for weekly totals, e.g. "12h58". */
function formatWeeklyTotal(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

/**
 * Compact, single-line week date range. When both ends share a month the month
 * is only printed once, e.g. "22 – 28 May"; otherwise "27 Apr – 3 May".
 */
function formatWeekRange(weekStart: Date, weekEnd: Date): string {
  const start = isSameMonth(weekStart, weekEnd)
    ? format(weekStart, "d", LOCALE_OPTIONS)
    : format(weekStart, "d MMM", LOCALE_OPTIONS);
  return `${start} – ${format(weekEnd, "d MMM", LOCALE_OPTIONS)}`;
}

/**
 * The week's training verdict (Undertrained → Overreaching), as a colour-dotted
 * chip. The trailing-average delta that feeds the under/over edges is kept in
 * the tooltip so the calendar stays uncluttered.
 */
function VerdictChip({ week }: { week: JournalWeek }) {
  if (week.verdict == null) {
    return null;
  }
  const deltaPct =
    week.loadTrend != null ? Math.round((week.loadTrend - 1) * 100) : null;
  const tooltip =
    deltaPct != null
      ? `${week.verdict.label} · ${deltaPct > 0 ? "+" : ""}${deltaPct}% vs. trailing 4-week average`
      : week.verdict.label;
  return (
    <span
      className="flex min-w-0 items-center gap-1 text-[11px] font-medium"
      style={{ color: week.verdict.color }}
      title={tooltip}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: week.verdict.color }}
      />
      <span className="truncate">{week.verdict.label}</span>
    </span>
  );
}

function WeekSummary({ week }: { week: JournalWeek }) {
  const hasActual = week.totalSeconds > 0;
  const hasPlanned = week.plannedSeconds > 0;
  // An upcoming (or otherwise activity-free) week with plans: the planned total
  // becomes the headline, in the muted "to-do" language of the planned chips.
  const plannedOnly = !hasActual && hasPlanned;

  if (plannedOnly) {
    return (
      <div className="border-border bg-muted/40 flex flex-col justify-center gap-0.5 border-l px-2">
        <div className="text-muted-foreground flex items-center gap-1 text-sm font-semibold tabular-nums">
          <CalendarClockIcon className="size-3.5 shrink-0" aria-hidden />
          {formatWeeklyTotal(week.plannedSeconds)}
        </div>
        <div className="text-muted-foreground/70 text-[11px]">planned</div>
      </div>
    );
  }

  return (
    <div className="border-border bg-muted/40 flex flex-col justify-center gap-1 border-l px-2">
      <div className="text-foreground text-sm font-semibold tabular-nums">
        {formatWeeklyTotal(week.totalSeconds)}
      </div>
      {hasPlanned && (
        <div
          className="text-muted-foreground flex items-center gap-1 text-[11px] tabular-nums"
          title={`${formatWeeklyTotal(week.plannedSeconds)} of training still planned this week`}
        >
          <CalendarClockIcon className="size-3 shrink-0" aria-hidden />+
          {formatWeeklyTotal(week.plannedSeconds)} planned
        </div>
      )}
      <div className="text-muted-foreground text-xs whitespace-nowrap">
        <span className="text-foreground font-medium tabular-nums">
          {Math.round(week.totalLoad)}
        </span>{" "}
        load
      </div>
      <VerdictChip week={week} />
    </div>
  );
}

function JournalWeekRowImpl({
  week,
  dayLoadScale,
  style,
}: {
  week: JournalWeek;
  dayLoadScale: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      role="row"
      className={cn(
        "border-border absolute grid w-full border-b",
        JOURNAL_GRID_COLS,
      )}
      style={style}
    >
      <div className="flex flex-col justify-center px-2">
        <div className="text-muted-foreground text-[11px] leading-none font-medium uppercase">
          {format(week.weekStart, "'W'w", LOCALE_OPTIONS)}
        </div>
        {week.monthStart != null && (
          <div className="text-foreground text-xs leading-tight font-semibold whitespace-nowrap md:hidden">
            {week.monthStart}
          </div>
        )}
        <div className="text-foreground text-xs leading-tight font-medium whitespace-nowrap max-md:hidden">
          {formatWeekRange(week.weekStart, week.weekEnd)}
        </div>
      </div>

      {week.days.map((day) => (
        <JournalDayCell
          key={day.date.toISOString()}
          day={day}
          dayLoadScale={dayLoadScale}
        />
      ))}

      <WeekSummary week={week} />
    </div>
  );
}

export const JournalWeekRow = React.memo(JournalWeekRowImpl);
