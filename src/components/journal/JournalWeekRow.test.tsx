// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { JournalWeekRow, ROW_HEIGHT } from "./JournalWeekRow";
import type { JournalWeek } from "./useJournalWeeks";

vi.mock("~/hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("~/i18n/useT", () => ({ useT: () => (key: string) => key }));
vi.mock("./WeeklyLoadChart", () => ({ WeeklyLoadChart: () => null }));

afterEach(cleanup);

const week: JournalWeek = {
  weekStart: new Date(2026, 9, 12),
  weekEnd: new Date(2026, 9, 18),
  days: [],
  activities: [],
  totalSeconds: 3600,
  plannedSeconds: 0,
  totalLoad: 80,
  sportBreakdown: [],
  previousWeekDailyLoad: null,
  loadTrend: null,
  monthStart: null,
  verdict: null,
};

it("opens the week summary from the keyboard on desktop", async () => {
  render(
    <JournalWeekRow week={week} dayLoadScale={0} start={0} size={ROW_HEIGHT} />,
  );
  const trigger = screen.getByRole("button", { name: "journal.moreInfo" });

  act(() => trigger.focus());
  // Enter on a focused native button dispatches a click.
  fireEvent.click(trigger);
  const summary = await screen.findByRole("dialog", {
    name: "journal.weekSummaryTitle",
  });

  fireEvent.keyDown(summary, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});
