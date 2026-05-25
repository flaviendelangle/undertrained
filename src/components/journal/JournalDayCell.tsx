import * as React from "react";

import { format } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";
import { FlagIcon, MedalIcon } from "lucide-react";
import Link from "next/link";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { formatActivityType } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";

import { ActivityPreviewCard } from "./ActivityPreviewCard";
import { useJournalPlanner } from "./journalPlanner";
import { PlannedTrainingChip } from "./PlannedTrainingChip";
import type { JournalActivity, JournalDay } from "./useJournalWeeks";

/** Activity chips shown before collapsing the rest into a "+N more" badge. */
const MAX_VISIBLE_ACTIVITIES = 3;

/**
 * Strava `workoutType` values that mark an activity as a race. Strava encodes
 * this per sport: `1` for runs, `11` for rides.
 */
const RACE_WORKOUT_TYPES = new Set([1, 11]);

/**
 * Map of `stravaId → all-time record labels` for the loaded athlete, provided by
 * the Journal so chips can badge PRs without prop-drilling through the memoized
 * week rows. Empty by default (no records / still loading).
 */
export const JournalRecordsContext = React.createContext<Map<number, string[]>>(
  new Map(),
);

const LOCALE_OPTIONS = { locale: enGB };

/** Discrete training-load zone a day falls into, relative to a busy day. */
export type LoadTier = "none" | "easy" | "moderate" | "hard";

/** Left-edge stripe colour + label per load zone (shared with the legend). */
export const TIER_STYLE: Record<
  Exclude<LoadTier, "none">,
  { bar: string; label: string }
> = {
  easy: { bar: "bg-chart-5", label: "Easy" },
  moderate: { bar: "bg-chart-8", label: "Moderate" },
  hard: { bar: "bg-chart-1", label: "Hard" },
};

/**
 * Bucket a day's load into a zone relative to the athlete's own busy day
 * (`scale` ≈ their 90th-percentile day): up to half of that is easy, up to a
 * full busy day is moderate, beyond it is hard.
 */
function getLoadTier(totalLoad: number, scale: number): LoadTier {
  if (totalLoad <= 0) {
    return "none";
  }
  if (scale <= 0) {
    return "easy";
  }
  const ratio = totalLoad / scale;
  if (ratio <= 0.5) {
    return "easy";
  }
  if (ratio <= 1) {
    return "moderate";
  }
  return "hard";
}

function ActivityChip({ activity }: { activity: JournalActivity }) {
  const config = getSportConfig(activity.type);
  const Icon = config.icon;
  const stats = config.formatJournalStats(activity);

  const records = React.useContext(JournalRecordsContext);
  const activityRecords = records.get(activity.stravaId);
  const isRace =
    activity.workoutType != null && RACE_WORKOUT_TYPES.has(activity.workoutType);
  const isPr = activityRecords != null && activityRecords.length > 0;

  return (
    <ActivityPreviewCard activity={activity} records={activityRecords}>
      <Link
        href={`/activities/${activity.stravaId}?from=journal`}
        aria-label={isRace ? `Race: ${activity.name}` : activity.name}
        className={cn(
          "flex min-w-0 flex-col gap-0.5 rounded px-1 py-0.5 leading-tight transition-colors hover:brightness-95 dark:hover:brightness-110",
          // Races get a gold ring so they stand out from training days.
          isRace && "ring-1 ring-amber-400/80 ring-inset",
        )}
        style={{
          backgroundColor: `color-mix(in oklab, ${config.color} 16%, transparent)`,
        }}
      >
        <span className="flex min-w-0 items-center gap-1">
          <Icon className="size-3 shrink-0" style={{ color: config.color }} />
          <span className="text-foreground truncate text-xs font-medium">
            {activity.name || formatActivityType(activity.type)}
          </span>
          {isRace && (
            <FlagIcon
              className="size-3 shrink-0 text-amber-500"
              aria-label="Race"
            />
          )}
          {isPr && (
            <MedalIcon
              className="size-3 shrink-0 text-amber-500"
              aria-label={`Personal record: ${activityRecords?.join(", ")}`}
            />
          )}
        </span>
        {stats && (
          <span className="text-muted-foreground truncate text-[11px] tabular-nums">
            {stats}
          </span>
        )}
      </Link>
    </ActivityPreviewCard>
  );
}

export function JournalDayCell({
  day,
  dayLoadScale,
}: {
  day: JournalDay;
  dayLoadScale: number;
}) {
  const visible = day.activities.slice(0, MAX_VISIBLE_ACTIVITIES);
  const hiddenCount = day.activities.length - visible.length;
  const planner = useJournalPlanner();

  // Encode the day's load as a discrete zone shown on the cell's left edge, so
  // the calendar reads as a training-intensity map without ambiguity.
  const tier = getLoadTier(day.totalLoad, dayLoadScale);

  return (
    <div
      role="gridcell"
      aria-current={day.isToday ? "date" : undefined}
      // Double-click an empty part of the cell to plan a training on this day.
      onDoubleClick={() => planner?.onCreatePlanned(day.date)}
      className="border-border relative flex min-w-0 cursor-default flex-col gap-0.5 overflow-hidden border-l px-1 py-1 first:border-l-0"
    >
      {tier !== "none" && (
        <span
          aria-hidden
          title={`${TIER_STYLE[tier].label} load · ${Math.round(day.totalLoad)}`}
          className={cn(
            "absolute top-0 bottom-0 left-0 w-0.75",
            TIER_STYLE[tier].bar,
          )}
        />
      )}
      {/* Fixed-height, centered row so today's pill doesn't grow the header and
          push this cell's chips out of alignment with the rest of the week. */}
      <div className="flex h-5 items-center">
        <span
          aria-label={format(day.date, "EEEE d MMMM", LOCALE_OPTIONS)}
          className={cn(
            "text-muted-foreground px-1 text-[11px] leading-none font-medium",
            day.isToday &&
              "bg-primary text-primary-foreground rounded-full px-1.5 py-0.5",
          )}
        >
          {format(day.date, "d")}
        </span>
      </div>

      <div
        className="flex min-h-0 flex-col gap-0.5"
        // Double-clicking existing content shouldn't also open the planner.
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {day.plannedTrainings.map((training) => (
          <PlannedTrainingChip key={training.id} training={training} />
        ))}
        {visible.map((activity) => (
          <ActivityChip key={activity.stravaId} activity={activity} />
        ))}
        {hiddenCount > 0 && (
          <Popover>
            <PopoverTrigger className="text-muted-foreground hover:text-foreground w-fit cursor-pointer px-1 text-[11px] leading-none underline-offset-2 transition-colors hover:underline">
              +{hiddenCount} more
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60 gap-2 p-2">
              <div className="text-muted-foreground px-1 text-xs font-medium">
                {format(day.date, "EEEE d MMMM", LOCALE_OPTIONS)}
              </div>
              <div className="flex flex-col gap-0.5">
                {day.activities.map((activity) => (
                  <ActivityChip key={activity.stravaId} activity={activity} />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
