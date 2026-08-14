// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import type {
  DragKeyboardMoveDetails,
  DragLocationHistory,
  DropTargetRecord,
} from "@base-ui/react/draggable";
import type { PlannedTraining } from "@server/db/types";

import {
  JOURNAL_DRAG_AUTO_SCROLL_AXIS,
  JOURNAL_SLOT_HEIGHT,
  getJournalDragPreviewTime,
  journalDayDropKind,
  journalKeyboardMovement,
  resolveJournalDrop,
} from "./journalDnd";

function makeDayTarget(snappedY: number): DropTargetRecord<string> {
  const element = document.createElement("div");
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 200, 140, 1152),
  );
  return {
    element,
    label: "2026-08-11",
    kind: journalDayDropKind.id,
    payload: "2026-08-11",
    getLocalPoint: () => ({ x: 0.5, y: snappedY }),
    getSnappedLocalPoint: () => ({ x: 0.5, y: snappedY }),
  };
}

function makeLocation(
  target: DropTargetRecord<string> | null,
  clientX: number,
  clientY: number,
): DragLocationHistory {
  const input = {
    button: -1,
    buttons: 1,
    clientX,
    clientY,
    pageX: clientX,
    pageY: clientY,
    pointerType: "mouse" as const,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  };
  const current = { input, dropTargets: target == null ? [] : [target] };
  return { initial: current, current, previous: current };
}

describe("resolveJournalDrop", () => {
  it("does nothing when a pointer is released outside the timed grid", () => {
    const day = makeDayTarget(10 / 24);

    // Simulate a stale/modified target stack while the raw pointer is over the
    // sticky header, above the day column's top edge.
    expect(resolveJournalDrop(makeLocation(day, 150, 150))).toBeNull();
  });

  it("uses the target's source-anchored 15-minute snap", () => {
    const day = makeDayTarget(10 / 24);

    expect(resolveJournalDrop(makeLocation(day, 150, 680))).toEqual({
      dayKey: "2026-08-11",
      minutes: 600,
    });
  });
});

describe("Journal drag preview", () => {
  it("shows the prospective destination time and omits it off-target", () => {
    expect(
      getJournalDragPreviewTime({ dayKey: "2026-08-11", minutes: 600 }),
    ).toBe("10:00");
    expect(getJournalDragPreviewTime(null)).toBeUndefined();
  });

  it("keeps horizontal edge scrolling disabled", () => {
    expect(JOURNAL_DRAG_AUTO_SCROLL_AXIS).toBe("vertical");
  });
});

describe("journalKeyboardMovement", () => {
  const baseDetails = {
    position: { x: 300, y: 480 },
  } as DragKeyboardMoveDetails<PlannedTraining>;

  it("moves vertically by one 15-minute slot", () => {
    expect(
      journalKeyboardMovement({
        ...baseDetails,
        direction: { x: 0, y: 1 },
      }),
    ).toEqual({ x: 300, y: 480 + JOURNAL_SLOT_HEIGHT });
  });

  it("moves horizontally to the adjacent day", () => {
    const nextDay = document.createElement("div");
    vi.spyOn(nextDay, "getBoundingClientRect").mockReturnValue(
      new DOMRect(700, 200, 100, 1152),
    );

    expect(
      journalKeyboardMovement({
        ...baseDetails,
        direction: { x: 1, y: 0 },
        findTarget: () => nextDay,
      }),
    ).toEqual({ x: 750, y: 480 });
  });
});
