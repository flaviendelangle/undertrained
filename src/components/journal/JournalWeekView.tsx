import * as React from "react";

import { addDays, format, isSameMonth } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";
import {
  DragDropProvider,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useReschedulePlannedTraining } from "~/hooks/useReschedulePlannedTraining";
import { cn } from "~/lib/utils";

import { useJournalPlanner } from "./journalPlanner";
import { buildWeekGroups } from "./journalView";
import type { JournalWeek } from "./useJournalWeeks";
import {
  buildDayEvents,
  COMPACT_BLOCK_HEIGHT,
  HOUR_HEIGHT,
  MIN_BLOCK_HEIGHT,
  MINUTES_PER_DAY,
  MINUTES_PER_PIXEL,
  minutesToTimeLabel,
  packDayEvents,
  snapMinutes,
  type PositionedEvent,
} from "./weekGrid";
import {
  WeekActivityBlock,
  WeekPlannedBlock,
  WeekPlannedBlockGhost,
} from "./WeekEventBlock";
import type { PlannedTraining } from "@server/db/types";

const LOCALE_OPTIONS = { locale: enGB };

/** Shared grid template: a fixed hour-axis gutter, then 7 equal day columns. */
const GRID_TEMPLATE = "3.25rem repeat(7, minmax(0, 1fr))";

/** Hour the grid scrolls to when the week has no events to anchor on. */
const DEFAULT_SCROLL_HOUR = 6;

const TOTAL_HEIGHT = (MINUTES_PER_DAY / 60) * HOUR_HEIGHT;

const HOURS = Array.from({ length: 24 }, (_, h) => h);

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

/** Live drop preview: which day and the snapped start minute, plus the training. */
interface DropPreview {
  dayKey: string;
  minutes: number;
  training: PlannedTraining;
}

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

/** The snapped, full-opacity drop target shown in a day column while dragging. */
function PreviewGhost({ preview }: { preview: DropPreview }) {
  const durationMinutes = preview.training.durationSeconds / 60;
  const height = Math.max(MIN_BLOCK_HEIGHT, (durationMinutes / 60) * HOUR_HEIGHT);
  return (
    <div
      className="pointer-events-none absolute right-0 left-0 z-20 pr-0.5"
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
  const { ref, isDropTarget } = useDroppable({ id: format(date, "yyyy-MM-dd") });
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
          className="absolute pr-0.5"
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

function JournalWeekViewImpl({
  week,
  weeks,
  onSelectWeek,
}: {
  week: JournalWeek;
  weeks: JournalWeek[];
  /** Navigate the week view to the week starting on the given Monday. */
  onSelectWeek: (weekStart: Date) => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const reschedule = useReschedulePlannedTraining();

  // The corner week picker: every loaded week, newest first, grouped under its
  // month for scannability. One item per week, jumping straight to it.
  const weekGroups = React.useMemo(() => buildWeekGroups(weeks), [weeks]);
  // Live ghost shown at the prospective drop slot (Google-Calendar style); the
  // floating drag clone is disabled via the Feedback plugin below.
  const [preview, setPreview] = React.useState<DropPreview | null>(null);

  // Per-day positioned events (overlaps packed), plus the earliest start minute
  // across the week so the grid can open on the first event rather than midnight.
  const { dayEvents, earliestMinutes } = React.useMemo(() => {
    const perDayEvents = week.days.map((day) => buildDayEvents(day));
    const starts = perDayEvents.flatMap((events) =>
      events.map((event) => event.startMinutes),
    );
    return {
      dayEvents: perDayEvents.map((events) => packDayEvents(events)),
      earliestMinutes: starts.length > 0 ? Math.min(...starts) : Infinity,
    };
  }, [week]);

  // Open the grid near the first event of the week (or 06:00 when empty).
  React.useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const body = bodyRef.current;
    if (!scroller || !body) {
      return;
    }
    const startMinutes = Number.isFinite(earliestMinutes)
      ? earliestMinutes
      : DEFAULT_SCROLL_HOUR * 60;
    const eventTop = (startMinutes / 60) * HOUR_HEIGHT;
    scroller.scrollTop = body.offsetTop + Math.max(0, eventTop - HOUR_HEIGHT);
  }, [earliestMinutes, week.weekStart]);

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
    const training = week.days
      .flatMap((day) => day.plannedTrainings)
      .find((item) => item.id === trainingId);
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
        : { dayKey: drop.dayKey, minutes: drop.minutes, training: drop.training },
    );
  };

  const handleDragStart = (event: DragStartEvent) => updatePreview(event.operation);
  const handleDragMove = (event: DragMoveEvent) => updatePreview(event.operation);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <DragDropProvider
          sensors={SENSORS}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
        >
          <div
            className="bg-accent border-border sticky top-0 z-20 grid border-b"
            style={{ gridTemplateColumns: GRID_TEMPLATE }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                title="Jump to week"
                className="hover:bg-background/60 flex cursor-pointer flex-col items-center justify-center gap-0.5 py-2 outline-none transition-colors"
              >
                <span className="text-foreground flex items-center gap-0.5 text-[11px] leading-none font-semibold">
                  {format(week.weekStart, "'W'w", LOCALE_OPTIONS)}
                  <ChevronDownIcon className="size-3" />
                </span>
                <span className="text-muted-foreground text-[10px] leading-none tabular-nums">
                  {format(week.weekStart, "yyyy")}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 w-52">
                {weekGroups.map((group) => (
                  <DropdownMenuGroup key={group.month.toISOString()}>
                    <DropdownMenuLabel>
                      {format(group.month, "MMMM yyyy", LOCALE_OPTIONS)}
                    </DropdownMenuLabel>
                    {group.weeks.map((item) => {
                      const end = addDays(item.weekStart, 6);
                      const range = isSameMonth(item.weekStart, end)
                        ? `${format(item.weekStart, "d")}–${format(end, "d MMM", LOCALE_OPTIONS)}`
                        : `${format(item.weekStart, "d MMM", LOCALE_OPTIONS)} – ${format(end, "d MMM", LOCALE_OPTIONS)}`;
                      const isActive =
                        item.weekStart.getTime() === week.weekStart.getTime();
                      return (
                        <DropdownMenuItem
                          key={item.weekStart.toISOString()}
                          onClick={() => onSelectWeek(item.weekStart)}
                          className={cn(
                            "justify-between gap-3 tabular-nums",
                            isActive && "text-foreground font-semibold",
                          )}
                        >
                          <span>{format(item.weekStart, "'W'w", LOCALE_OPTIONS)}</span>
                          <span className="text-muted-foreground text-xs">
                            {range}
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {week.days.map((day) => (
              <div
                key={day.date.toISOString()}
                className="border-border flex flex-col items-center gap-1 border-l py-2"
              >
                <span
                  className={cn(
                    "text-[10px] font-medium tracking-wide uppercase",
                    day.isToday ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {format(day.date, "EEE", LOCALE_OPTIONS)}
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
            ))}
          </div>

          <div
            ref={bodyRef}
            className="grid"
            style={{ gridTemplateColumns: GRID_TEMPLATE }}
          >
            <TimeAxis />
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
