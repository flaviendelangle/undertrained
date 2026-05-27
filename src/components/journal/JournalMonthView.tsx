import * as React from "react";

import { addDays, format } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

import { JOURNAL_GRID_COLS, JournalWeekRow, ROW_HEIGHT } from "./JournalWeekRow";
import { buildMonthGroups, weekIndexForMonth } from "./journalView";
import type { JournalWeek } from "./useJournalWeeks";

// Rows are tall (160px) and heavy (7 day cells + a summary), so each extra row
// rendered out of view is real work on mount and on every view switch. Keep a
// small buffer to mask fast-scroll flashes, but no more — visible rows + 2×this
// is what gets built.
const VIRTUALIZER_OVERSCAN = 3;

// Monday → Sunday short labels, derived once via a known Monday (1 Jan 2024).
const DAY_NAMES = Array.from({ length: 7 }, (_, i) =>
  format(addDays(new Date(2024, 0, 1), i), "EEE", { locale: enGB }),
);

function HeaderCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border flex items-center px-2 py-2 not-first:border-l",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The Journal's month-like overview: a vertically-scrolling, virtualized list of
 * week rows (Monday → Sunday), newest first. The corner cell jumps to any month;
 * the topmost visible week is reported up via {@link onVisibleWeekChange} so it
 * drives both the header month/year label and the week the week-view opens on.
 */
function JournalMonthViewImpl({
  weeks,
  dayLoadScale,
  isError,
  anchorWeekStart,
  scrollNonce,
  onVisibleWeekChange,
}: {
  weeks: JournalWeek[];
  dayLoadScale: number;
  isError: boolean;
  anchorWeekStart: Date | null;
  /** Bumped by the Journal to request a (re)scroll to {@link anchorWeekStart}. */
  scrollNonce: number;
  onVisibleWeekChange: (weekStart: Date) => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: weeks.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
    overscan: VIRTUALIZER_OVERSCAN,
  });

  // On mount, land on the anchor week (the week last visible before a view
  // switch; on first load the Journal seeds it to the latest non-empty week).
  const didInitialScroll = React.useRef(false);
  // Gates the visible-week → URL sync below until the mount scroll has settled,
  // so neither the initial top-of-list render nor the programmatic scroll to the
  // anchor writes a redundant navigation (each one re-renders the whole Journal).
  const allowReport = React.useRef(false);
  React.useEffect(() => {
    if (didInitialScroll.current || weeks.length === 0) {
      return;
    }
    didInitialScroll.current = true;
    const target = anchorWeekStart?.getTime();
    const index =
      target != null
        ? weeks.findIndex((week) => week.weekStart.getTime() === target)
        : -1;
    if (index > 0) {
      rowVirtualizer.scrollToIndex(index, { align: "start" });
    }
    // Open reporting only once the scroll above has flushed (two frames), so
    // the next sync comes from a genuine user scroll, not the mount itself.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        allowReport.current = true;
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, [weeks, anchorWeekStart, rowVirtualizer]);

  // Scroll to the anchor week on an explicit request (e.g. "Today"); the initial
  // nonce is skipped so this never double-fires with the mount scroll above.
  const initialNonce = React.useRef(scrollNonce);
  React.useEffect(() => {
    if (scrollNonce === initialNonce.current || weeks.length === 0) {
      return;
    }
    const target = anchorWeekStart?.getTime();
    const index =
      target != null
        ? weeks.findIndex((week) => week.weekStart.getTime() === target)
        : -1;
    if (index >= 0) {
      rowVirtualizer.scrollToIndex(index, { align: "start" });
    }
  }, [scrollNonce, weeks, anchorWeekStart, rowVirtualizer]);

  // Month and year of the topmost visible week, shown in the (otherwise static)
  // header cell — they update as you scroll, à la Strava — and reported upward.
  const topIndex = Math.min(
    weeks.length - 1,
    Math.max(0, Math.floor((rowVirtualizer.scrollOffset ?? 0) / ROW_HEIGHT)),
  );
  const visibleWeekStart = weeks[topIndex]?.weekStart ?? new Date();
  const visibleMonth = format(visibleWeekStart, "MMM", { locale: enGB });
  const visibleYear = visibleWeekStart.getFullYear();

  // Keep the Journal's anchor in sync with the visible week (keyed on the week's
  // timestamp so it only fires on a week change, not every scroll frame).
  const visibleWeekTime = weeks[topIndex]?.weekStart.getTime() ?? null;
  React.useEffect(() => {
    if (allowReport.current && visibleWeekTime != null) {
      onVisibleWeekChange(new Date(visibleWeekTime));
    }
  }, [visibleWeekTime, onVisibleWeekChange]);

  // Every month spanned by the timeline, newest first, grouped by year — the
  // contents of the corner month picker.
  const monthGroups = React.useMemo(() => buildMonthGroups(weeks), [weeks]);

  // Jump to the last week of the chosen month (clamped to the newest week for
  // the current/future month, whose final week may not exist yet).
  const scrollToMonth = (month: Date) => {
    rowVirtualizer.scrollToIndex(weekIndexForMonth(weeks, month), {
      align: "start",
    });
  };

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <div className="min-w-150 md:min-w-194" role="grid">
        <div
          role="row"
          className={cn(
            "bg-accent text-muted-foreground sticky top-0 z-10 grid text-xs uppercase",
            JOURNAL_GRID_COLS,
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              title="Jump to month"
              className="border-border hover:bg-background/60 flex cursor-pointer flex-col items-start justify-center gap-0.5 px-2 py-2 leading-none tabular-nums uppercase outline-none transition-colors"
            >
              <span className="text-foreground flex items-center gap-1 font-semibold">
                {visibleMonth}
                <ChevronDownIcon className="size-3" />
              </span>
              <span>{visibleYear}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-80 w-40 normal-case"
            >
              {monthGroups.map((group) => (
                <DropdownMenuGroup key={group.year}>
                  <DropdownMenuLabel>{group.year}</DropdownMenuLabel>
                  {group.months.map((month) => (
                    <DropdownMenuItem
                      key={month.toISOString()}
                      onClick={() => scrollToMonth(month)}
                    >
                      {format(month, "MMMM", { locale: enGB })}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {DAY_NAMES.map((name) => (
            <HeaderCell key={name}>{name}</HeaderCell>
          ))}
          <HeaderCell className="bg-accent sticky right-0 z-20">
            Summary
          </HeaderCell>
        </div>

        {isError ? (
          <div className="text-muted-foreground p-8 text-center text-sm">
            Couldn&apos;t load your activities. Please try again.
          </div>
        ) : weeks.length === 0 ? (
          <div className="text-muted-foreground p-8 text-center text-sm">
            No activities yet.
          </div>
        ) : (
          <div
            className="relative"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const week = weeks[virtualRow.index];
              return (
                <JournalWeekRow
                  key={week.weekStart.toISOString()}
                  week={week}
                  dayLoadScale={dayLoadScale}
                  style={{
                    top: 0,
                    left: 0,
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export const JournalMonthView = React.memo(JournalMonthViewImpl);
