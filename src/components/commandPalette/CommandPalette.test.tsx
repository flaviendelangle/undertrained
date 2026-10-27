// @vitest-environment happy-dom
import { BikeIcon, PlayIcon } from "lucide-react";
import { RouterContext } from "next/dist/shared/lib/router-context.shared-runtime";
import type { NextRouter } from "next/router";
import { afterEach, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { CommandPalette } from "./CommandPalette";
import type { CommandGroup, CommandStep } from "./useCommandGroups";

/**
 * The palette's wiring to Autocomplete: choosing an item runs it, and steps
 * reset the input. What the groups contain is `useCommandGroups`' job.
 */

vi.mock("~/i18n/useT", () => {
  const t = (key: string) => key;
  return { useT: () => t };
});
vi.mock("~/components/journal/PlannedTrainingDialog", () => ({
  PlannedTrainingDialog: () => null,
}));
vi.mock("./useCommandGroups", () => ({
  useCommandGroups: ({
    query,
    step,
  }: {
    query: string;
    step: CommandStep;
  }): { groups: CommandGroup[]; searching: boolean; searchError: boolean } => {
    const items =
      step === "ride"
        ? [{ id: "ride:1", label: "Sweet spot", icon: BikeIcon }]
        : [
            {
              id: "action:start-ride",
              label: "Start a live ride",
              icon: PlayIcon,
              action: "start-ride" as const,
            },
            {
              id: "page:activities",
              label: "Activities",
              icon: BikeIcon,
              href: "/activities?view=42",
            },
          ];
    const words = query.toLowerCase();
    return {
      groups: [
        {
          id: step === "ride" ? "ride" : "actions",
          label: step,
          items: items.filter((item) =>
            item.label.toLowerCase().includes(words),
          ),
        },
      ],
      searching: false,
      searchError: false,
    };
  },
}));

afterEach(cleanup);

function renderPalette() {
  const router = {
    pathname: "/journal",
    asPath: "/journal",
    query: {},
    push: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
    beforePopState: vi.fn(),
  };
  const onOpenChange = vi.fn();
  render(
    <RouterContext.Provider value={router as unknown as NextRouter}>
      <CommandPalette open onOpenChange={onOpenChange} />
    </RouterContext.Provider>,
  );
  return { router, onOpenChange };
}

it.each(["click", "Enter"])(
  "navigates a page link with %s and closes the palette",
  async (activation) => {
    const { router, onOpenChange } = renderPalette();
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "Activities" } });
    const item = screen.getByRole("option", { name: "Activities" });
    expect(item.tagName).toBe("A");
    expect(item.getAttribute("href")).toBe("/activities?view=42");

    if (activation === "click") fireEvent.click(item);
    else fireEvent.keyDown(input, { key: "Enter" });

    expect(router.push).toHaveBeenCalledOnce();
    expect(router.push.mock.calls[0][0]).toBe("/activities?view=42");
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  },
);

it.each(["ctrlKey", "metaKey", "shiftKey", "altKey", "middle"])(
  "leaves %s page link clicks to the browser without closing the palette",
  async (modifier) => {
    const { router, onOpenChange } = renderPalette();
    await screen.findByRole("combobox");
    const item = screen.getByRole("option", { name: "Activities" });
    expect(item.tagName).toBe("A");
    expect(item.getAttribute("href")).toBe("/activities?view=42");

    const allowed =
      modifier === "middle"
        ? fireEvent(
            item,
            new MouseEvent("auxclick", {
              bubbles: true,
              cancelable: true,
              button: 1,
            }),
          )
        : fireEvent.click(item, { [modifier]: true });

    expect(allowed).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  },
);

it("runs the highlighted action on Enter and goes back on Backspace", async () => {
  renderPalette();
  const input = await screen.findByRole("combobox");

  fireEvent.change(input, { target: { value: "live" } });
  expect(
    screen.getByRole("option", { name: "Start a live ride" }),
  ).toBeTruthy();

  act(() => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  // The action ran, and the workout picker starts with an empty query.
  expect(input).toHaveProperty("value", "");
  expect(screen.getByRole("option", { name: "Sweet spot" })).toBeTruthy();
  expect(input).toHaveProperty("placeholder", "commandPalette.ridePlaceholder");

  fireEvent.keyDown(input, { key: "Backspace" });
  expect(
    screen.getByRole("option", { name: "Start a live ride" }),
  ).toBeTruthy();
  expect(input).toHaveProperty("placeholder", "commandPalette.placeholder");
});
