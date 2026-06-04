import * as React from "react";

import { format } from "date-fns";
import {
  CalendarCheckIcon,
  CalendarPlusIcon,
  CalendarRangeIcon,
  EllipsisIcon,
  PlusIcon,
} from "lucide-react";
import { useRouter } from "next/router";
import { useValueAsRef } from "@base-ui/utils/useValueAsRef";
import { PreviewCard } from "@base-ui/react/preview-card";

import { CalendarOverlayDialog } from "~/components/settings/CalendarOverlayPanel";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useBusyEvents } from "~/hooks/useBusyEvents";
import { usePersonalRecords } from "~/hooks/usePersonalRecords";
import { usePlannedTrainings } from "~/hooks/usePlannedTrainings";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { formZoneLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { classifyForm } from "~/lib/fitness";
import { startOf } from "~/utils/dateUtils";
import { getLoadPreferences } from "~/utils/getActivityLoad";

import { ActivityPreviewHost } from "./ActivityPreviewCard";
import { CalendarFeedDialog } from "./CalendarFeedButton";
import { JournalRecordsContext } from "./JournalDayCell";
import { JournalMonthView } from "./JournalMonthView";
import { JournalPlannerContext } from "./journalPlanner";
import {
  JournalPreviewProvider,
  type ActivityPreviewPayload,
  type JournalPreviewHandles,
} from "./journalPreview";
import { JournalViewContext, type JournalView } from "./journalView";
import { JournalWeekView } from "./JournalWeekView";
import { WeekSummaryPreviewHost } from "./JournalWeekRow";
import {
  PlannedTrainingDialog,
  type PlannerDialogState,
} from "./PlannedTrainingDialog";
import { useJournalWeeks, type JournalWeek } from "./useJournalWeeks";

const VIEW_OPTIONS: JournalView[] = ["month", "week"];

/** URL date key (yyyy-MM-dd) for a week's Monday, stored in `?week=`. */
function weekParamOf(weekStart: Date): string {
  return format(weekStart, "yyyy-MM-dd");
}

/** Build the journal location `/journal/<view>` (+ `?week=`), used for routing. */
function journalHref(view: JournalView, weekParam: string | null): string {
  return weekParam ? `/journal/${view}?week=${weekParam}` : `/journal/${view}`;
}

export function Journal() {
  const t = useT();
  const { data: activities, isError } = useActivitiesQuery();
  const { data: plannedTrainings } = usePlannedTrainings();
  const { data: busyEvents, showAllDayRow } = useBusyEvents();
  const { timeline } = useRiderSettingsTimeline();
  const records = usePersonalRecords();

  const loadPreferences = React.useMemo(
    () => getLoadPreferences(timeline),
    [timeline],
  );

  const { weeks, dayLoadScale, currentForm } = useJournalWeeks(
    activities,
    loadPreferences,
    plannedTrainings,
    busyEvents,
  );

  // View and current week live in the URL (`/journal/<view>?week=<yyyy-MM-dd>`)
  // so that returning from an activity restores the same view, and the right
  // scroll (month) / page (week). Both are read here and written on change.
  const router = useRouter();
  const viewParam = Array.isArray(router.query.view)
    ? router.query.view[0]
    : router.query.view;
  const view: JournalView = viewParam === "week" ? "week" : "month";
  const weekParam =
    typeof router.query.week === "string" ? router.query.week : null;
  const urlAnchor = React.useMemo(
    () => (weekParam ? startOf(new Date(`${weekParam}T00:00:00`), "week") : null),
    [weekParam],
  );

  // Calendar-subscription dialog, opened from the overflow menu.
  const [subscribeOpen, setSubscribeOpen] = React.useState(false);
  // External-calendar overlay manager, opened from the overflow menu.
  const [calendarsOpen, setCalendarsOpen] = React.useState(false);
  // Bumped to ask the month view to (re)scroll to the anchor week — e.g. "Today".
  const [scrollNonce, setScrollNonce] = React.useState(0);

  // The anchor week: the URL's `?week=` if present, else the latest non-future
  // week with an activity or plan. It's the week the week view renders and the
  // month view scrolls to. Future weeks are skipped so a training planned weeks
  // ahead (now rendered, see useJournalWeeks) doesn't pull the opening view past
  // today; the user scrolls up to reach it.
  const seededAnchor = React.useMemo(() => {
    if (weeks.length === 0) {
      return null;
    }
    const thisWeekStart = startOf(new Date(), "week").getTime();
    const index = weeks.findIndex(
      (week) =>
        week.weekStart.getTime() <= thisWeekStart &&
        (week.activities.length > 0 ||
          week.days.some((day) => day.plannedTrainings.length > 0)),
    );
    if (index >= 0) {
      return weeks[index].weekStart;
    }
    // Nothing done or planned up to today: open on the current week if it's in
    // range, else the oldest loaded week.
    const currentWeek = weeks.find(
      (week) => week.weekStart.getTime() === thisWeekStart,
    );
    return (currentWeek ?? weeks[weeks.length - 1]).weekStart;
  }, [weeks]);
  const effectiveAnchor = urlAnchor ?? seededAnchor;

  // Update the URL (shallow, no scroll reset) when the view or week changes.
  // `useValueAsRef` keeps these in sync with the latest render so `navigate`
  // stays stable — otherwise the month view's scroll-reporting effect would
  // re-fire and spam navigations every render.
  const routerRef = useValueAsRef(router);
  const weekParamRef = useValueAsRef(weekParam);
  const navigate = React.useCallback(
    (nextView: JournalView, weekStart: Date | null) => {
      const nextWeekParam = weekStart
        ? weekParamOf(weekStart)
        : weekParamRef.current;
      void routerRef.current.replace(
        journalHref(nextView, nextWeekParam),
        undefined,
        { shallow: true, scroll: false },
      );
    },
    [routerRef, weekParamRef],
  );

  const setView = (nextView: JournalView) => navigate(nextView, effectiveAnchor);
  const onVisibleWeekChange = React.useCallback(
    (weekStart: Date) => navigate("month", weekStart),
    [navigate],
  );
  const onSelectWeek = React.useCallback(
    (weekStart: Date) => navigate("week", weekStart),
    [navigate],
  );

  // The two hover cards shared across every activity chip and week summary —
  // created once so a busy calendar mounts cheap detached triggers instead of a
  // card instance per chip/row (see {@link JournalPreviewHandles}).
  const [previewHandles] = React.useState<JournalPreviewHandles>(() => ({
    activity: PreviewCard.createHandle<ActivityPreviewPayload>(),
    summary: PreviewCard.createHandle<JournalWeek>(),
  }));

  // Planner dialog state, exposed to the day cells / event blocks via context so
  // the memoized week rows aren't broken by prop-drilling.
  const [dialogState, setDialogState] =
    React.useState<PlannerDialogState>(null);
  const onCreatePlanned = React.useCallback(
    (date: Date) => setDialogState({ mode: "create", date }),
    [],
  );
  const onEditPlanned = React.useCallback(
    (training: NonNullable<typeof plannedTrainings>[number]) =>
      setDialogState({ mode: "edit", training }),
    [],
  );
  const plannerValue = React.useMemo(
    () => ({ onCreatePlanned, onEditPlanned }),
    [onCreatePlanned, onEditPlanned],
  );

  // Today's Form (TSB) and its zone, for the header readout.
  const formZone = currentForm != null ? classifyForm(currentForm.tsb) : null;

  // Resolve the week the week view renders (the anchor week, or the newest week
  // when no anchor matches the loaded range).
  const anchorIndex =
    effectiveAnchor != null
      ? weeks.findIndex(
          (week) => week.weekStart.getTime() === effectiveAnchor.getTime(),
        )
      : -1;
  const weekIndex = anchorIndex >= 0 ? anchorIndex : 0;
  const activeWeek = weeks[weekIndex] ?? null;
  // Jump both views to the current week (the week view re-renders it; the month
  // view scrolls to it via the bumped nonce).
  const goToToday = () => {
    const todayWeek = startOf(new Date(), "week").getTime();
    const match = weeks.find((week) => week.weekStart.getTime() === todayWeek);
    if (match != null) {
      navigate(view, match.weekStart);
      setScrollNonce((nonce) => nonce + 1);
    }
  };

  return (
    <JournalPreviewProvider value={previewHandles}>
    <JournalPlannerContext.Provider value={plannerValue}>
      <JournalRecordsContext.Provider value={records}>
       <JournalViewContext.Provider value={view}>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="text-muted-foreground border-border flex items-center justify-between gap-3 border-b px-3 py-1.5 text-[11px]">
            <div className="flex min-w-0 items-center gap-3">
              {formZone != null && currentForm != null ? (
                <span
                  className="flex items-center gap-1.5 font-medium"
                  title={t("journal.form.tooltip", {
                    value: `${currentForm.tsb > 0 ? "+" : ""}${Math.round(currentForm.tsb)}`,
                    zone: formZoneLabel(formZone.key, t),
                  })}
                >
                  <span className="uppercase">{t("journal.form.label")}</span>
                  <span
                    className="inline-flex items-center gap-1 rounded px-1.5 py-px tabular-nums"
                    style={{
                      color: formZone.color,
                      backgroundColor: `${formZone.color}22`,
                    }}
                  >
                    {currentForm.tsb > 0 ? "+" : ""}
                    {Math.round(currentForm.tsb)}
                    <span className="not-italic">
                      · {formZoneLabel(formZone.key, t)}
                    </span>
                  </span>
                </span>
              ) : null}

            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("journal.options")}
                  >
                    <EllipsisIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuRadioGroup
                  value={view}
                  onValueChange={(value) => setView(value as JournalView)}
                >
                  <DropdownMenuLabel>{t("journal.view.label")}</DropdownMenuLabel>
                  {VIEW_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem
                      key={option}
                      value={option}
                      closeOnClick
                    >
                      {option === "week"
                        ? t("journal.view.week")
                        : t("journal.view.month")}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem closeOnClick onClick={goToToday}>
                  <CalendarCheckIcon />
                  {t("journal.navigateToToday")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onCreatePlanned(new Date())}>
                  <PlusIcon />
                  {t("journal.planTraining")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSubscribeOpen(true)}>
                  <CalendarPlusIcon />
                  {t("journal.subscribe")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCalendarsOpen(true)}>
                  <CalendarRangeIcon />
                  {t("journal.calendars.manage")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {view === "week" && activeWeek != null ? (
            <JournalWeekView
              week={activeWeek}
              weeks={weeks}
              dayLoadScale={dayLoadScale}
              reserveAllDayRow={showAllDayRow}
              scrollNonce={scrollNonce}
              onSelectWeek={onSelectWeek}
            />
          ) : (
            <JournalMonthView
              weeks={weeks}
              dayLoadScale={dayLoadScale}
              isError={isError}
              anchorWeekStart={effectiveAnchor}
              scrollNonce={scrollNonce}
              onVisibleWeekChange={onVisibleWeekChange}
            />
          )}

          {/* Shared hover cards: one popup each for all chips / week summaries. */}
          <ActivityPreviewHost handle={previewHandles.activity} />
          <WeekSummaryPreviewHost handle={previewHandles.summary} />

          <PlannedTrainingDialog
            state={dialogState}
            onClose={() => setDialogState(null)}
          />
          <CalendarFeedDialog
            open={subscribeOpen}
            onOpenChange={setSubscribeOpen}
          />
          <CalendarOverlayDialog
            open={calendarsOpen}
            onOpenChange={setCalendarsOpen}
          />
        </div>
       </JournalViewContext.Provider>
      </JournalRecordsContext.Provider>
    </JournalPlannerContext.Provider>
    </JournalPreviewProvider>
  );
}
