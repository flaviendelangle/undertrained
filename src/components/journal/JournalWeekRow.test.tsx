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

async function openSummary(w: JournalWeek) {
  render(
    <JournalWeekRow week={w} dayLoadScale={0} start={0} size={ROW_HEIGHT} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "journal.moreInfo" }));
  return screen.findByRole("dialog", { name: "journal.weekSummaryTitle" });
}

it("hides the 4-week comparison until the week has a full history window", async () => {
  // `loadTrend` is set but `verdict` isn't: the baseline covers < 4 weeks.
  const summary = await openSummary({ ...week, loadTrend: 1.2 });
  expect(summary.textContent).not.toContain("journal.deltaVsAverage");
});

it("shows the 4-week comparison once the week is judged", async () => {
  const summary = await openSummary({
    ...week,
    loadTrend: 1.2,
    verdict: { key: "productive", label: "Productive", color: "#000" },
  });
  expect(summary.textContent).toContain("journal.deltaVsAverage");
});
