import * as React from "react";

import type { PlannedTraining } from "@server/db/types";

/**
 * Lets day cells open the planner without prop-drilling through the memoized
 * week rows (mirrors `JournalRecordsContext`). Provided by the Journal, which
 * owns the create/edit dialog state.
 */
export interface JournalPlannerContextValue {
  /** Open the dialog to create a plan on the given local day. */
  onCreatePlanned: (date: Date) => void;
  /** Open the dialog to edit (or mark done) an existing plan. */
  onEditPlanned: (training: PlannedTraining) => void;
}

export const JournalPlannerContext =
  React.createContext<JournalPlannerContextValue | null>(null);

export function useJournalPlanner(): JournalPlannerContextValue | null {
  return React.useContext(JournalPlannerContext);
}
