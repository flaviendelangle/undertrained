// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { StepActionsMenu } from "./StepActionsMenu";

afterEach(cleanup);

it.each(["Up", "Down"] as const)(
  "exposes Move %s as a keyboard alternative to dragging",
  async (direction) => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    render(
      <StepActionsMenu
        isRepeat={false}
        canWrap
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDuplicate={vi.fn()}
        onWrap={vi.fn()}
        onUngroup={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "workouts.step.actions",
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const action = await screen.findByRole("menuitem", {
      name: `workouts.step.move${direction}`,
    });
    action.focus();
    fireEvent.keyDown(action, { key: "Enter" });
    expect(direction === "Up" ? onMoveUp : onMoveDown).toHaveBeenCalledOnce();
    expect(direction === "Up" ? onMoveDown : onMoveUp).not.toHaveBeenCalled();
  },
);
