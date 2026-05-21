import * as React from "react";

import { format, isSameMonth } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import { JournalDayCell } from "./JournalDayCell";
import type { JournalWeek } from "./useJournalWeeks";

/** Fixed height of every week row, regardless of how many activities it holds. */
export const ROW_HEIGHT = 150;

/** Grid template shared by the header and the rows so columns stay aligned. */
export const JOURNAL_GRID_COLS =
  "grid-cols-[3rem_repeat(7,minmax(0,1fr))_5rem] md:grid-cols-[7rem_repeat(7,minmax(0,1fr))_7rem]";

const LOCALE_OPTIONS = { locale: enGB };

/**
 * A week's load is treated as "flat" (no arrow) when it sits within ±15% of the
 * trailing average, so normal week-to-week wobble doesn't read as a trend.
 */
const TREND_FLAT_BAND = 0.15;

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

function LoadTrend({ trend }: { trend: number }) {
  const deltaPct = Math.round((trend - 1) * 100);
  if (Math.abs(trend - 1) < TREND_FLAT_BAND) {
    return null;
  }
  const up = trend > 1;
  const Icon = up ? TrendingUpIcon : TrendingDownIcon;
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 text-[11px] font-medium tabular-nums",
        up ? "text-destructive" : "text-muted-foreground",
      )}
      title={`${deltaPct > 0 ? "+" : ""}${deltaPct}% vs. trailing 4-week average`}
    >
      <Icon className="size-3 shrink-0" />
      {Math.abs(deltaPct)}%
    </span>
  );
}

function WeekSummary({ week }: { week: JournalWeek }) {
  return (
    <div className="border-border bg-muted/40 flex flex-col justify-center gap-1 border-l px-2">
      <div className="text-foreground text-sm font-semibold tabular-nums">
        {formatWeeklyTotal(week.totalSeconds)}
      </div>
      <div className="text-muted-foreground flex items-center gap-1 text-xs whitespace-nowrap">
        <span className="whitespace-nowrap">
          <span className="text-foreground font-medium tabular-nums">
            {Math.round(week.totalLoad)}
          </span>{" "}
          load
        </span>
        {week.loadTrend != null && <LoadTrend trend={week.loadTrend} />}
      </div>
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
