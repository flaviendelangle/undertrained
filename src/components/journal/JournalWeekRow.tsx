import * as React from "react";

import { format, isSameMonth, startOfDay } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";
import { CalendarClockIcon } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "~/components/ui/drawer";
import {
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from "~/components/ui/preview-card";
import { useIsMobile } from "~/hooks/useIsMobile";
import { cn } from "~/lib/utils";
import { SPORT_CATEGORY_META } from "~/utils/sportConfig";

import { JournalDayCell } from "./JournalDayCell";
import { WeeklyLoadChart } from "./WeeklyLoadChart";
import type { JournalWeek } from "./useJournalWeeks";

/** Fixed height of every week row, regardless of how many activities it holds. */
export const ROW_HEIGHT = 160;

/** Grid template shared by the header and the rows so columns stay aligned. */
export const JOURNAL_GRID_COLS =
  "grid-cols-[3rem_repeat(7,minmax(0,1fr))_5rem] md:grid-cols-[7rem_repeat(7,minmax(0,1fr))_7rem]";

/**
 * Shared classes for every cell of the right-pinned Summary column. It stays
 * stuck to the right edge while the day columns scroll horizontally (the grid is
 * wider than the viewport on mobile). The `before` underlay paints an opaque
 * `bg-background` beneath the translucent `bg-muted/40` so the scrolling day
 * cells don't bleed through the pinned column.
 */
const SUMMARY_CELL =
  "border-border bg-muted/40 sticky right-0 z-10 isolate flex flex-col justify-center border-l px-2 before:absolute before:inset-0 before:-z-10 before:bg-background before:content-['']";

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
      className="flex min-w-0 items-center gap-1 text-[11px] leading-none font-medium"
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

/**
 * Hover-card detail for a week's summary: a header line (range, total duration
 * and load), the verdict, the per-sport-category breakdown, and the cumulative
 * weekly-load comparison chart. Only mounts while the card is open.
 */
function WeekSummaryCardBody({ week }: { week: JournalWeek }) {
  const todayStart = startOfDay(new Date()).getTime();
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-foreground text-sm font-medium">
            {formatWeekRange(week.weekStart, week.weekEnd)}
          </span>
          <span className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
            {formatWeeklyTotal(week.totalSeconds)} ·{" "}
            <span className="text-foreground font-medium">
              {Math.round(week.totalLoad)}
            </span>{" "}
            load
          </span>
        </div>
        <VerdictChip week={week} />
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
                <span className="text-foreground">{meta.label}</span>
                <span className="text-muted-foreground ml-auto tabular-nums">
                  {formatWeeklyTotal(stat.totalSeconds)}
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
            This week
          </span>
          {week.previousWeekDailyLoad != null && (
            <span className="flex items-center gap-1">
              <span className="bg-muted-foreground size-1.5 rounded-full" />
              Previous week
            </span>
          )}
        </div>
      </div>
    </div>
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
      <div className={cn(SUMMARY_CELL, "gap-0.5")}>
        <div className="text-muted-foreground flex items-center gap-1 text-sm font-semibold tabular-nums">
          <CalendarClockIcon className="size-3.5 shrink-0" aria-hidden />
          {formatWeeklyTotal(week.plannedSeconds)}
        </div>
        <div className="text-muted-foreground/70 text-[11px]">planned</div>
      </div>
    );
  }

  // The week's headline figures, shared by the desktop hover trigger and the
  // mobile cell. The "still planned" line is hidden on mobile to save space.
  const cellInner = (
    <>
      <div className="text-foreground text-sm font-semibold tabular-nums">
        {formatWeeklyTotal(week.totalSeconds)}
      </div>
      {hasPlanned && (
        <div
          className="text-muted-foreground flex items-center gap-1 text-[11px] tabular-nums max-md:hidden"
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
 * Reveals the week's detail card, picking the interaction to match the device:
 * a hover `PreviewCard` over the whole cell on desktop, and on mobile (where
 * there is no hover) a discrete "More info" button that opens the detail as a
 * bottom-sheet `Drawer`. Both reuse the same {@link WeekSummaryCardBody}.
 */
function WeekSummaryDisclosure({
  week,
  children,
}: {
  week: JournalWeek;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer>
        <div className={cn(SUMMARY_CELL, "gap-1")}>
          {children}
          <DrawerTrigger
            render={
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground mt-0.5 w-fit text-[11px] whitespace-nowrap underline underline-offset-2"
              />
            }
          >
            More info
          </DrawerTrigger>
        </div>
        <DrawerContent>
          {/* Screen-reader heading; the visible range lives in the body header. */}
          <DrawerTitle className="sr-only">
            {formatWeekRange(week.weekStart, week.weekEnd)} summary
          </DrawerTitle>
          <WeekSummaryCardBody week={week} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <PreviewCard>
      <PreviewCardTrigger
        render={<div className={cn(SUMMARY_CELL, "gap-1")}>{children}</div>}
      />
      <PreviewCardContent side="left" align="center" className="w-80">
        <WeekSummaryCardBody week={week} />
      </PreviewCardContent>
    </PreviewCard>
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
