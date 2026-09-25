// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import type {
  DragLocationHistory,
  DropTargetRecord,
} from "@base-ui/react/draggable";

import {
  getJournalDragPreviewTime,
  handleJournalDragScroll,
  journalDayDropKind,
  resolveJournalDrop,
  resolveJournalMoveEnd,
} from "./journalDnd";

function makeDayTarget(snappedY: number): DropTargetRecord<string> {
  const element = document.createElement("div");
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 200, 140, 1152),
  );
  return {
    element,
    updatePayload: vi.fn(),
    dragData: undefined,
    updateDragData: vi.fn(),
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
    const cancel = vi.fn();
    handleJournalDragScroll({ direction: "horizontal" }, { cancel });
    expect(cancel).toHaveBeenCalledOnce();
    cancel.mockClear();
    handleJournalDragScroll({ direction: "vertical" }, { cancel });
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("resolveJournalMoveEnd", () => {
  it("commits a released drag over a day", () => {
    const day = makeDayTarget(10 / 24);
    expect(
      resolveJournalMoveEnd({
        canceled: false,
        dropTarget: day,
        location: makeLocation(day, 150, 680),
      }),
    ).toEqual({ dayKey: "2026-08-11", minutes: 600 });
  });

  it("does not commit a canceled drag even with a day in the location", () => {
    const day = makeDayTarget(10 / 24);
    expect(
      resolveJournalMoveEnd({
        canceled: true,
        dropTarget: day,
        location: makeLocation(day, 150, 680),
      }),
    ).toBeNull();
  });

  it("does not commit an off-target release with a stale location", () => {
    const day = makeDayTarget(10 / 24);
    expect(
      resolveJournalMoveEnd({
        canceled: false,
        dropTarget: null,
        location: makeLocation(day, 150, 680),
      }),
    ).toBeNull();
  });
});
