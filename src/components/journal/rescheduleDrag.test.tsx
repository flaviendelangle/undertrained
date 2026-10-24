// @vitest-environment happy-dom
import * as React from "react";

import { addDays, format } from "date-fns";
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { Draggable } from "@base-ui/react/draggable";
import type { PlannedTraining } from "@server/db/types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { startOf } from "~/utils/dateUtils";
import type { LoadAlgorithmPreferences } from "~/utils/getActivityLoad";

import {
  RescheduleDay,
  RescheduleSource,
  RescheduleViewport,
  useRescheduleDrag,
} from "./rescheduleDrag";
import { useJournalWeeks } from "./useJournalWeeks";
import { HOUR_HEIGHT, minutesFromIso } from "./weekGrid";

type Reschedule = (
  training: PlannedTraining,
  plannedDate: string,
  options?: { onSettled?: () => void },
) => boolean;

// The mutation is the module's seam to the server: each test decides whether
// it starts and when it settles, and plays the query cache by re-rendering.
const reschedule = vi.hoisted(() => vi.fn<Reschedule>());
vi.mock("~/hooks/useReschedulePlannedTraining", () => ({
  useReschedulePlannedTraining: () => reschedule,
}));

const LOAD_PREFERENCES: LoadAlgorithmPreferences = {
  cyclingLoadAlgorithm: "tss",
  runningLoadAlgorithm: "rtss",
  swimmingLoadAlgorithm: "stss",
};

const COLUMN_WIDTH = 100;
const DAY_HEIGHT = 24 * HOUR_HEIGHT;

// Anchored on the current week so `useJournalWeeks` always renders it.
const monday = startOf(new Date(), "week");
const dayKey = (offset: number) =>
  format(addDays(monday, offset), "yyyy-MM-dd");

function plan(
  id: number,
  title: string,
  plannedDate: string,
  durationSeconds = 3600,
): PlannedTraining {
  return {
    id,
    athlete: 7,
    title,
    plannedDate,
    durationSeconds,
    sportType: "Run",
    workoutChoice: "workout",
    status: "planned",
    structuredWorkoutId: null,
    linkedActivityId: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

/**
 * The week view's composition: the weeks `useJournalWeeks` builds from the
 * cache go through the module, and the columns and blocks of this week and the
 * next register with it. Each block reads "<day> <start time>" and is named
 * after its training.
 */
function WeekGrid({ trainings }: { trainings: PlannedTraining[] }) {
  const { weeks: cachedWeeks } = useJournalWeeks(
    undefined,
    LOAD_PREFERENCES,
    trainings,
  );
  const { weeks, drag } = useRescheduleDrag(cachedWeeks);
  // `weeks` is newest first: lay out this week, then the next.
  const days = weeks
    .filter((week) => week.weekStart.getTime() >= monday.getTime())
    .toReversed()
    .flatMap((week) => week.days);
  return (
    <RescheduleViewport drag={drag} gridTop={0} className="viewport">
      {days.map((day, index) => {
        const key = format(day.date, "yyyy-MM-dd");
        return (
          <RescheduleDay
            key={key}
            dayKey={key}
            className="day"
            style={{
              position: "absolute",
              left: index * COLUMN_WIDTH,
              width: COLUMN_WIDTH,
              height: DAY_HEIGHT,
            }}
          >
            {day.plannedTrainings.map((training) => {
              const continued = !training.plannedDate.startsWith(key);
              const top = continued
                ? 0
                : (minutesFromIso(training.plannedDate) / 60) * HOUR_HEIGHT;
              return (
                <RescheduleSource
                  key={training.id}
                  training={training}
                  disabled={continued}
                  render={<button type="button" aria-label={training.title} />}
                  style={{ position: "absolute", top, height: HOUR_HEIGHT }}
                  renderPreview={({ time }) =>
                    `Moving ${training.title} to ${time ?? "nowhere"}`
                  }
                >
                  {`${key} ${training.plannedDate.slice(11, 16)}`}
                </RescheduleSource>
              );
            })}
          </RescheduleDay>
        );
      })}
    </RescheduleViewport>
  );
}

/** Where each block of `title` is shown, as "<day> <start time>". */
function shown(title: string) {
  return screen
    .queryAllByRole("button", { name: title })
    .map((block) => block.textContent);
}

function dimmed(title: string) {
  return screen
    .queryAllByRole("button", { name: title })
    .map((block) => block.hasAttribute("data-dimmed"));
}

function settleLastSave() {
  act(() => reschedule.mock.lastCall?.[2]?.onSettled?.());
}

// happy-dom has no layout. Each element gets the box its inline style
// describes, offset by its ancestors', which is all this grid needs.
function styleBox(element: HTMLElement): DOMRect {
  let x = 0;
  let y = 0;
  for (
    let node: HTMLElement | null = element;
    node != null;
    node = node.parentElement
  ) {
    x += parseFloat(node.style.left) || 0;
    y += parseFloat(node.style.top) || 0;
  }
  return new DOMRect(
    x,
    y,
    parseFloat(element.style.width) || 0,
    parseFloat(element.style.height) || 0,
  );
}

function columnAt(x: number, y: number): Element {
  const columns = [...document.querySelectorAll(".day")];
  return (
    columns.find((column) => {
      const rect = column.getBoundingClientRect();
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    }) ?? document.body
  );
}

function pointer(
  type: "pointerDown" | "pointerMove" | "pointerUp",
  target: Element | Document,
  x: number,
  y: number,
) {
  fireEvent[type](target, {
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: type === "pointerUp" ? 0 : 1,
    clientX: x,
    clientY: y,
  });
}

// Movement is processed once per animation frame.
function nextFrame() {
  return act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

// Grabbed below its top edge, so a pointer-anchored drop would land later.
const GRAB = { x: 50, y: 30 };
let pointerAt = { x: 0, y: 0 };

async function moveTo(x: number, y: number) {
  pointerAt = { x, y };
  pointer("pointerMove", document, x, y);
  await nextFrame();
}

async function pickUp(block: HTMLElement) {
  const rect = block.getBoundingClientRect();
  pointer("pointerDown", block, rect.left + GRAB.x, rect.top + GRAB.y);
  // Past the activation threshold.
  await moveTo(rect.left + GRAB.x, rect.top + GRAB.y + 10);
}

/** Moves the pointer so the picked-up block's top edge is at `time` on a day. */
function dragTopTo(dayOffset: number, time: string) {
  const minutes = minutesFromIso(`${dayKey(dayOffset)}T${time}`);
  return moveTo(
    dayOffset * COLUMN_WIDTH + GRAB.x,
    (minutes / 60) * HOUR_HEIGHT + GRAB.y,
  );
}

function release() {
  pointer("pointerUp", document, pointerAt.x, pointerAt.y);
}

async function drop(block: HTMLElement, dayOffset: number, time: string) {
  await pickUp(block);
  await dragTopTo(dayOffset, time);
  release();
}

let elementFromPoint: MockInstance<Document["elementFromPoint"]>;

beforeEach(() => {
  reschedule.mockReset().mockReturnValue(true);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return styleBox(this);
    },
  );
  elementFromPoint = vi
    .spyOn(document, "elementFromPoint")
    .mockImplementation(columnAt);
});

afterEach(() => {
  // A drag left running would leak into the next test.
  fireEvent.keyDown(document, { key: "Escape" });
  cleanup();
  vi.restoreAllMocks();
});

const tempo = plan(1, "Tempo", `${dayKey(0)}T10:00:00`);

describe("dropping a planned training", () => {
  it("moves it to the slot under its top edge", async () => {
    render(<WeekGrid trainings={[tempo]} />);

    // Next week's Wednesday.
    await drop(screen.getByRole("button", { name: "Tempo" }), 9, "12:15");

    expect(reschedule).toHaveBeenCalledOnce();
    expect(reschedule.mock.lastCall?.slice(0, 2)).toEqual([
      tempo,
      `${dayKey(9)}T12:15:00`,
    ]);
    expect(shown("Tempo")).toEqual([`${dayKey(9)} 12:15`]);
  });

  it.each([
    {
      name: "Escape cancels it",
      end: () => fireEvent.keyDown(document, { key: "Escape" }),
    },
    {
      name: "it's released outside the grid",
      end: async () => {
        await moveTo(GRAB.x, DAY_HEIGHT + 100);
        release();
      },
    },
    {
      // A stale target record still under a pointer that's over the sticky
      // header must not count as a drop on the day.
      name: "it's released above the day columns",
      end: async () => {
        elementFromPoint.mockImplementation(() =>
          document.querySelector(".day")!,
        );
        await moveTo(GRAB.x, -20);
        release();
      },
    },
    {
      name: "it's dropped back on its own slot",
      end: async () => {
        await dragTopTo(0, "10:00");
        release();
      },
    },
  ])("leaves it in place when $name", async ({ end }) => {
    render(<WeekGrid trainings={[tempo]} />);

    await pickUp(screen.getByRole("button", { name: "Tempo" }));
    await dragTopTo(3, "15:00");
    await end();
    await nextFrame();

    expect(reschedule).not.toHaveBeenCalled();
    expect(shown("Tempo")).toEqual([`${dayKey(0)} 10:00`]);
    expect(dimmed("Tempo")).toEqual([false]);
  });

  it("shows it at its destination before Base UI removes the drag clone", async () => {
    let shownWhenCloneRemoved: (string | null)[] = [];
    // Registered after the module's own monitor (parent effects run last), so
    // it runs just before Base UI tears the drag clone down.
    function CloneRemovalProbe({ children }: { children: React.ReactNode }) {
      Draggable.useDragMonitor({
        accept: Draggable.anyKind,
        onMoveEnd: () => {
          shownWhenCloneRemoved = shown("Tempo");
        },
      });
      return children;
    }
    render(
      <CloneRemovalProbe>
        <WeekGrid trainings={[tempo]} />
      </CloneRemovalProbe>,
    );

    await drop(screen.getByRole("button", { name: "Tempo" }), 1, "08:00");

    expect(shownWhenCloneRemoved).toEqual([`${dayKey(1)} 08:00`]);
  });
});

describe("the dropped training's placement", () => {
  const destination = `${dayKey(1)}T08:00:00`;
  const moved = { ...tempo, plannedDate: destination };

  it("holds the destination until the cache shows the move", async () => {
    const { rerender } = render(<WeekGrid trainings={[tempo]} />);

    await drop(screen.getByRole("button", { name: "Tempo" }), 1, "08:00");
    // The drag has ended, the save is in flight, the cache is still stale.
    await nextFrame();
    expect(shown("Tempo")).toEqual([`${dayKey(1)} 08:00`]);

    rerender(<WeekGrid trainings={[moved]} />);
    settleLastSave();
    expect(shown("Tempo")).toEqual([`${dayKey(1)} 08:00`]);
  });

  it("puts the training back when the save is rolled back", async () => {
    const { rerender } = render(<WeekGrid trainings={[tempo]} />);

    await drop(screen.getByRole("button", { name: "Tempo" }), 1, "08:00");
    // The optimistic write, then its rollback.
    rerender(<WeekGrid trainings={[moved]} />);
    rerender(<WeekGrid trainings={[tempo]} />);
    settleLastSave();

    expect(shown("Tempo")).toEqual([`${dayKey(0)} 10:00`]);
  });

  it("puts the training back when the save can't start", async () => {
    reschedule.mockReturnValue(false);
    render(<WeekGrid trainings={[tempo]} />);

    await drop(screen.getByRole("button", { name: "Tempo" }), 1, "08:00");

    expect(shown("Tempo")).toEqual([`${dayKey(0)} 10:00`]);
  });

  it("doesn't disturb the next drag when its save settles", async () => {
    const easy = plan(3, "Easy", `${dayKey(2)}T07:00:00`);
    const { rerender } = render(<WeekGrid trainings={[tempo, easy]} />);
    await drop(screen.getByRole("button", { name: "Tempo" }), 1, "08:00");
    rerender(<WeekGrid trainings={[moved, easy]} />);

    await pickUp(screen.getByRole("button", { name: "Easy" }));
    await dragTopTo(5, "06:00");
    settleLastSave();

    expect(dimmed("Easy")).toEqual([true]);
    await dragTopTo(5, "06:30");
    expect(screen.getByText(/^Moving Easy/).textContent).toBe(
      "Moving Easy to 06:30",
    );
  });
});

describe("a multi-day plan", () => {
  // Monday 18:00 for 40 hours: Monday to Wednesday.
  const stage = plan(2, "Stage race", `${dayKey(0)}T18:00:00`, 40 * 3600);

  it("moves every day it covers", async () => {
    render(<WeekGrid trainings={[stage, tempo]} />);

    const [start] = screen.getAllByRole("button", { name: "Stage race" });
    await drop(start, 3, "18:00");

    expect(shown("Stage race")).toEqual([
      `${dayKey(3)} 18:00`,
      `${dayKey(4)} 18:00`,
      `${dayKey(5)} 18:00`,
    ]);
  });

  it("dims every day while it's dragged, and none once it's dropped", async () => {
    render(<WeekGrid trainings={[stage, tempo]} />);

    const [start] = screen.getAllByRole("button", { name: "Stage race" });
    await pickUp(start);
    await dragTopTo(3, "18:00");
    expect(dimmed("Stage race")).toEqual([true, true, true]);
    expect(dimmed("Tempo")).toEqual([false]);

    release();
    expect(dimmed("Stage race")).toEqual([false, false, false]);
  });
});

describe("the week grid", () => {
  it("scrolls vertically near its edge, but never across weeks", async () => {
    render(<WeekGrid trainings={[tempo]} />);
    // A 700 × 600 window onto a scrollable grid.
    const viewport = document.querySelector<HTMLElement>(".viewport")!;
    Object.assign(viewport.style, {
      width: "700px",
      height: "600px",
      overflow: "auto",
    });
    for (const [key, value] of Object.entries({
      clientWidth: 700,
      clientHeight: 600,
      scrollWidth: 7 * 700,
      scrollHeight: DAY_HEIGHT,
    })) {
      Object.defineProperty(viewport, key, { value });
    }
    const scrollBy = vi.fn<(options: ScrollToOptions) => void>();
    viewport.scrollBy = scrollBy as typeof viewport.scrollBy;

    await pickUp(screen.getByRole("button", { name: "Tempo" }));
    // Hold the pointer in the bottom-right corner, inside both edge zones.
    for (let frame = 0; frame < 5; frame += 1) {
      await moveTo(695, 595);
    }

    const scrolls = scrollBy.mock.calls.map(([options]) => options);
    expect(scrolls.some((options) => (options.top ?? 0) > 0)).toBe(true);
    expect(scrolls.every((options) => (options.left ?? 0) === 0)).toBe(true);
  });
});

describe("the drag preview", () => {
  it("shows the time the training would land at, and none off the grid", async () => {
    render(<WeekGrid trainings={[tempo]} />);

    await pickUp(screen.getByRole("button", { name: "Tempo" }));
    await dragTopTo(2, "07:45");
    expect(screen.getByText(/^Moving Tempo/).textContent).toBe(
      "Moving Tempo to 07:45",
    );

    // Within the same column, so only the move itself reports it.
    await dragTopTo(2, "09:30");
    expect(screen.getByText(/^Moving Tempo/).textContent).toBe(
      "Moving Tempo to 09:30",
    );

    await moveTo(GRAB.x, DAY_HEIGHT + 100);
    expect(screen.getByText(/^Moving Tempo/).textContent).toBe(
      "Moving Tempo to nowhere",
    );
  });
});
