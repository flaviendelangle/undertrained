import * as React from "react";

import { PreviewCard } from "@base-ui/react/preview-card";

import { ActivityPreviewHost } from "~/components/journal/ActivityPreviewCard";
import { ActivityBlock } from "~/components/journal/JournalDayCell";
import { PlannedTrainingChip } from "~/components/journal/PlannedTrainingChip";
import {
  PlannedTrainingDialog,
  type PlannerDialogState,
} from "~/components/journal/PlannedTrainingDialog";
import { JournalPlannerContext } from "~/components/journal/journalPlanner";
import {
  type ActivityPreviewPayload,
  type JournalPreviewHandles,
  JournalPreviewProvider,
} from "~/components/journal/journalPreview";
import type { JournalActivity } from "~/components/journal/useJournalWeeks";
import { coveredDayKeys } from "~/components/journal/weekGrid";
import { QueryState } from "~/components/primitives/QueryState";
import { usePlannedTrainingList } from "~/hooks/plannedTrainings";
import { useT } from "~/i18n/useT";
import { activityHref } from "~/utils/activityLinks";

export function FitnessDayEntries({
  activities,
  selectedDate,
}: {
  activities: JournalActivity[];
  selectedDate: string;
}) {
  const t = useT();
  const plannedQuery = usePlannedTrainingList();
  const plans =
    plannedQuery.data?.filter((training) =>
      coveredDayKeys(training.plannedDate, training.durationSeconds).includes(
        selectedDate,
      ),
    ) ?? [];
  const [handles] = React.useState<JournalPreviewHandles>(() => ({
    activity: PreviewCard.createHandle<ActivityPreviewPayload>(),
  }));
  const [dialogState, setDialogState] =
    React.useState<PlannerDialogState>(null);
  return (
    <JournalPreviewProvider value={handles}>
      <JournalPlannerContext.Provider
        value={{
          onCreatePlanned: (date) => setDialogState({ mode: "create", date }),
          onEditPlanned: (training) =>
            setDialogState({ mode: "edit", training }),
        }}
      >
        <div className="border-border border-t pt-4">
          <h2 className="mb-3 font-medium">{t("fitnessPage.details")}</h2>
          {plannedQuery.isError && (
            <QueryState error onRetry={() => void plannedQuery.refetch()} />
          )}
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((training) => (
              <PlannedTrainingChip
                key={training.id}
                training={training}
                variant="card"
              />
            ))}
            {activities.map((activity) => (
              <ActivityBlock
                key={activity.stravaId}
                activity={activity}
                variant="card"
                href={activityHref(
                  activity.stravaId,
                  `/fitness?day=${selectedDate}`,
                )}
              />
            ))}
          </div>
          {!plans.length &&
            !activities.length &&
            !plannedQuery.isLoading &&
            !plannedQuery.isError && (
              <p className="text-muted-foreground text-sm">
                {t("fitnessPage.noActivities")}
              </p>
            )}
        </div>
        <ActivityPreviewHost handle={handles.activity} />
        <PlannedTrainingDialog
          state={dialogState}
          onClose={() => setDialogState(null)}
        />
      </JournalPlannerContext.Provider>
    </JournalPreviewProvider>
  );
}
