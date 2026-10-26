// @vitest-environment happy-dom
import { BikeIcon, PlayIcon } from "lucide-react";
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
vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
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

it("runs the highlighted action on Enter and goes back on Backspace", async () => {
  render(<CommandPalette open onOpenChange={vi.fn()} />);
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
