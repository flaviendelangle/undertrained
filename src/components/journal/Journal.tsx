import * as React from "react";

import { addDays, addMonths, endOfMonth, format, startOfMonth } from "date-fns";
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
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { cn } from "~/lib/utils";
import { startOf } from "~/utils/dateUtils";
import { getLoadPreferences } from "~/utils/getActivityLoad";

import { TIER_STYLE } from "./JournalDayCell";
import {
  JOURNAL_GRID_COLS,
  JournalWeekRow,
  ROW_HEIGHT,
} from "./JournalWeekRow";
import { useJournalWeeks } from "./useJournalWeeks";

const VIRTUALIZER_OVERSCAN = 6;
const SKELETON_ROW_COUNT = 8;

// Load zones, easiest → hardest, for the heatmap legend.
const LOAD_LEGEND = [
  TIER_STYLE.easy,
  TIER_STYLE.moderate,
  TIER_STYLE.hard,
] as const;

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

export function Journal() {
  const { data: activities, isLoading, isError } = useActivitiesQuery();
  const { timeline } = useRiderSettingsTimeline();
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const loadPreferences = React.useMemo(
    () => getLoadPreferences(timeline),
    [timeline],
  );

  const { weeks, dayLoadScale } = useJournalWeeks(activities, loadPreferences);

  const rowVirtualizer = useVirtualizer({
    count: weeks.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
    overscan: VIRTUALIZER_OVERSCAN,
  });

  // Month and year of the topmost visible week, shown in the (otherwise static)
  // header cell — they update as you scroll, à la Strava.
  const topIndex = Math.min(
    weeks.length - 1,
    Math.max(0, Math.floor((rowVirtualizer.scrollOffset ?? 0) / ROW_HEIGHT)),
  );
  const visibleWeekStart = weeks[topIndex]?.weekStart ?? new Date();
  const visibleMonth = format(visibleWeekStart, "MMM", { locale: enGB });
  const visibleYear = visibleWeekStart.getFullYear();

  // Every month spanned by the timeline, newest first, grouped by year — the
  // contents of the corner month picker.
  const monthGroups = React.useMemo(() => {
    if (weeks.length === 0) {
      return [];
    }
    const newest = startOfMonth(weeks[0].weekStart);
    const oldest = startOfMonth(weeks[weeks.length - 1].weekStart);
    const groups: { year: number; months: Date[] }[] = [];
    for (
      let cursor = newest;
      cursor.getTime() >= oldest.getTime();
      cursor = addMonths(cursor, -1)
    ) {
      const year = cursor.getFullYear();
      const last = groups[groups.length - 1];
      if (last?.year === year) {
        last.months.push(cursor);
      } else {
        groups.push({ year, months: [cursor] });
      }
    }
    return groups;
  }, [weeks]);

  // Jump to the last week of the chosen month (clamped to the newest week for
  // the current/future month, whose final week may not exist yet).
  const scrollToMonth = (month: Date) => {
    const targetWeekStart = startOf(endOfMonth(month), "week").getTime();
    const index = weeks.findIndex(
      (week) => week.weekStart.getTime() <= targetWeekStart,
    );
    rowVirtualizer.scrollToIndex(index < 0 ? weeks.length - 1 : index, {
      align: "start",
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="text-muted-foreground border-border flex items-center justify-end gap-3 border-b px-3 py-1.5 text-[11px]">
        <span className="font-medium">Daily load</span>
        {LOAD_LEGEND.map(({ bar, label }) => (
          <span key={label} className="flex items-center gap-1">
            <span className={cn("h-2.5 w-0.75 rounded-full", bar)} />
            {label}
          </span>
        ))}
      </div>
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
            <HeaderCell>Summary</HeaderCell>
          </div>

          {isError ? (
            <div className="text-muted-foreground p-8 text-center text-sm">
              Couldn&apos;t load your activities. Please try again.
            </div>
          ) : isLoading ? (
            <div>
              {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
                <div
                  key={index}
                  className="border-border border-b"
                  style={{ height: ROW_HEIGHT }}
                >
                  <div className="bg-border mx-3 mt-3 h-4 w-40 animate-pulse rounded" />
                </div>
              ))}
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
    </div>
  );
}
