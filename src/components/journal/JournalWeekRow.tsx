import * as React from "react";

import { format, isSameMonth, startOfDay } from "date-fns";
import { CalendarClockIcon } from "lucide-react";

import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTitle,
  ResponsivePopoverTrigger,
} from "~/components/ui/responsive-popover";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { sportCategoryLabel, weeklyVerdictLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { formatCompactDuration } from "~/utils/format";
import { SPORT_CATEGORY_META } from "~/utils/sportConfig";

import { JournalDayCell } from "./JournalDayCell";
import { WeeklyLoadChart } from "./WeeklyLoadChart";
import type { JournalWeek } from "./useJournalWeeks";

/** Fixed height of every week row, regardless of how many activities it holds. */
export const ROW_HEIGHT = 160;

/** Grid template shared by the header and the rows so columns stay aligned. */
export const JOURNAL_GRID_COLS =
  "grid-cols-[3.75rem_repeat(7,minmax(0,1fr))_5rem] md:grid-cols-[7rem_repeat(7,minmax(0,1fr))_7rem]";

/**
 * Shared classes for every cell of the right-pinned Summary column. It stays
 * stuck to the right edge while the day columns scroll horizontally (the grid is
 * wider than the viewport on mobile). The `before` underlay paints an opaque
 * `bg-background` beneath the translucent `bg-muted/40` so the scrolling day
 * cells don't bleed through the pinned column.
 */
const SUMMARY_CELL =
  "border-border bg-muted/40 sticky right-0 z-10 isolate flex flex-col justify-center border-l px-2 before:absolute before:inset-0 before:-z-10 before:bg-background before:content-['']";

/**
 * Week date range; the month is printed once when both ends share it, e.g.
 * "22 – 28 May", otherwise "27 Apr – 3 May".
 */
function formatWeekRange(weekStart: Date, weekEnd: Date): string {
  const start = isSameMonth(weekStart, weekEnd)
    ? format(weekStart, "d", { locale: getActiveDateLocale() })
    : format(weekStart, "d MMM", { locale: getActiveDateLocale() });
  return `${start} – ${format(weekEnd, "d MMM", { locale: getActiveDateLocale() })}`;
}

/**
 * The week's training verdict (Undertrained → Overreaching), as a colour-dotted
 * chip. Only the label shows here so the calendar stays uncluttered; the
 * trailing-average delta that drives the under/over edges is surfaced in the
 * summary card instead (see {@link WeekSummaryCardBody}).
 */
function VerdictChip({ week }: { week: JournalWeek }) {
  const t = useT();
  if (week.verdict == null) {
    return null;
  }
  return (
    <span
      className="flex min-w-0 items-center gap-1 text-[11px] leading-none font-medium"
      style={{ color: week.verdict.color }}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: week.verdict.color }}
      />
      <span className="truncate">
        {weeklyVerdictLabel(week.verdict.key, t)}
      </span>
    </span>
  );
}

/** Detail card for a week's summary. Only mounts while the card is open. */
function WeekSummaryCardBody({ week }: { week: JournalWeek }) {
  const t = useT();
  const todayStart = startOfDay(new Date()).getTime();
  // Signed % the week's load sits above/below its trailing 4-week average — the
  // quantitative backing for the verdict, shown here rather than as a tooltip.
  const deltaPct =
    week.loadTrend != null ? Math.round((week.loadTrend - 1) * 100) : null;
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-foreground text-sm font-medium">
            {formatWeekRange(week.weekStart, week.weekEnd)}
          </span>
          <span className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
            {formatCompactDuration(week.totalSeconds)} ·{" "}
            <span className="text-foreground font-medium">
              {Math.round(week.totalLoad)}
            </span>{" "}
            {t("journal.load")}
          </span>
        </div>
        {week.verdict != null && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <VerdictChip week={week} />
            {deltaPct != null && (
              <span className="text-muted-foreground text-[11px] leading-none tabular-nums">
                {t("journal.deltaVsAverage", {
                  delta: `${deltaPct > 0 ? "+" : ""}${deltaPct}`,
                })}
              </span>
            )}
          </div>
        )}
        {week.plannedSeconds > 0 && (
          <div className="text-muted-foreground flex items-center gap-1 text-[11px] tabular-nums">
            <CalendarClockIcon className="size-3 shrink-0" aria-hidden />
            {t("journal.stillPlanned", {
              duration: formatCompactDuration(week.plannedSeconds),
            })}
          </div>
        )}
      </div>

      {week.sportBreakdown.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {week.sportBreakdown.map((stat) => {
            const meta = SPORT_CATEGORY_META[stat.category];
            const Icon = meta.icon;
            return (
              <div
                key={stat.category}
                className="flex items-center gap-2 text-xs"
              >
                <Icon
                  className="size-3.5 shrink-0"
                  style={{ color: meta.color }}
                  aria-hidden
                />
                <span className="text-foreground">
                  {sportCategoryLabel(stat.category, t)}
                </span>
                <span className="text-muted-foreground ml-auto tabular-nums">
                  {formatCompactDuration(stat.totalSeconds)}
                </span>
                <span className="text-foreground w-9 text-right font-medium tabular-nums">
                  {Math.round(stat.totalLoad)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <WeeklyLoadChart
          thisWeek={week.days.map((day) =>
            // Don't plot days that haven't happened yet (current/partial week),
            // otherwise the cumulative line runs flat to Sunday.
            day.date.getTime() > todayStart ? null : day.totalLoad,
          )}
          lastWeek={week.previousWeekDailyLoad}
        />
        <div className="text-muted-foreground flex items-center justify-center gap-3 text-[10px]">
          <span className="flex items-center gap-1">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: "var(--primary)" }}
            />
            {t("journal.thisWeek")}
          </span>
          {week.previousWeekDailyLoad != null && (
            <span className="flex items-center gap-1">
              <span className="bg-muted-foreground size-1.5 rounded-full" />
              {t("journal.previousWeek")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function WeekSummary({ week }: { week: JournalWeek }) {
  const t = useT();
  const hasActual = week.totalSeconds > 0;
  const hasPlanned = week.plannedSeconds > 0;
  // An upcoming (or otherwise activity-free) week with plans: the planned total
  // becomes the headline, in the muted "to-do" language of the planned chips.
  const plannedOnly = !hasActual && hasPlanned;

  if (plannedOnly) {
    return (
      <div className={cn(SUMMARY_CELL, "gap-0.5")}>
        <div className="text-muted-foreground flex items-center gap-1 text-sm font-semibold tabular-nums">
          <CalendarClockIcon className="size-3.5 shrink-0" aria-hidden />
          {formatCompactDuration(week.plannedSeconds)}
        </div>
        <div className="text-muted-foreground/70 text-[11px]">
          {t("journal.planned")}
        </div>
      </div>
    );
  }

  // The week's headline figures. The "still planned" line is hidden on mobile
  // to save space.
  const cellInner = (
    <>
      <div className="text-foreground text-sm font-semibold tabular-nums">
        {formatCompactDuration(week.totalSeconds)}
      </div>
      {hasPlanned && (
        <div className="text-muted-foreground flex items-center gap-1 text-[11px] tabular-nums max-md:hidden">
          <CalendarClockIcon className="size-3 shrink-0" aria-hidden />
          {t("journal.plannedDuration", {
            duration: formatCompactDuration(week.plannedSeconds),
          })}
        </div>
      )}
      <div className="text-muted-foreground text-xs whitespace-nowrap">
        <span className="text-foreground font-medium tabular-nums">
          {Math.round(week.totalLoad)}
        </span>{" "}
        {t("journal.load")}
      </div>
      <VerdictChip week={week} />
    </>
  );

  // Empty weeks (no completed activities) have nothing to detail — render the
  // bare pinned cell without a disclosure.
  if (!hasActual) {
    return <div className={cn(SUMMARY_CELL, "gap-1")}>{cellInner}</div>;
  }

  return <WeekSummaryDisclosure week={week}>{cellInner}</WeekSummaryDisclosure>;
}

/**
 * Reveals the week's detail card from a "More info" button under the headline
 * figures: an anchored Popover on desktop, a bottom-sheet Drawer on mobile. A
 * button rather than hover, so keyboard and touch users can reach it too.
 */
function WeekSummaryDisclosure({
  week,
  children,
}: {
  week: JournalWeek;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <ResponsivePopover>
      <div className={cn(SUMMARY_CELL, "gap-1")}>
        {children}
        <ResponsivePopoverTrigger
          render={
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground mt-0.5 w-fit cursor-pointer text-[11px] whitespace-nowrap underline underline-offset-2"
            />
          }
        >
          {t("journal.moreInfo")}
        </ResponsivePopoverTrigger>
      </div>
      <ResponsivePopoverContent side="left" className="md:w-80 md:p-0">
        {/* Screen-reader heading; the visible range lives in the body header. */}
        <ResponsivePopoverTitle className="sr-only">
          {t("journal.weekSummaryTitle", {
            range: formatWeekRange(week.weekStart, week.weekEnd),
          })}
        </ResponsivePopoverTitle>
        <WeekSummaryCardBody week={week} />
      </ResponsivePopoverContent>
    </ResponsivePopover>
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
          {format(week.weekStart, "'W'w", { locale: getActiveDateLocale() })}
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
