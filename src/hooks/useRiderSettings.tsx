import * as React from "react";

import { useAthleteId } from "~/hooks/useAthleteId";
import {
  DEFAULT_RIDER_SETTINGS,
  DEFAULT_RIDER_SETTINGS_TIMELINE,
  type RiderSettings,
  type RiderSettingsTimeline,
} from "~/sensors/types";
import {
  resolveCurrentRiderSettings,
  resolveRiderSettings,
} from "~/utils/resolveRiderSettings";
import { trpc } from "~/utils/trpc";

interface RiderSettingsContextValue {
  timeline: RiderSettingsTimeline;
  setTimeline: (timeline: RiderSettingsTimeline) => void;
  resolveForDate: (date: string) => RiderSettings;
  currentSettings: RiderSettings;
  hasSettings: boolean;
}

const RiderSettingsContext = React.createContext<RiderSettingsContextValue>({
  timeline: DEFAULT_RIDER_SETTINGS_TIMELINE,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setTimeline: () => {},
  resolveForDate: () => DEFAULT_RIDER_SETTINGS,
  currentSettings: DEFAULT_RIDER_SETTINGS,
  hasSettings: false,
});

export function RiderSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const athleteId = useAthleteId();
  const { data: stored } = trpc.riderSettings.get.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );
  const utils = trpc.useUtils();
  const saveSettings = trpc.riderSettings.save.useMutation({
    onSuccess: () => {
      void utils.riderSettings.get.invalidate();
      // Scores are recomputed in the background — invalidate dependent queries
      // so they refetch once recomputation finishes.
      void utils.activities.list.invalidate();
      void utils.analytics.getPowerCurve.invalidate();
      void utils.analytics.getPowerCurveYears.invalidate();
    },
  });

  const timeline: RiderSettingsTimeline = React.useMemo(
    () =>
      stored
        ? {
            cdA: stored.cdA,
            crr: stored.crr,
            bikeWeightKg:
              stored.bikeWeightKg ??
              DEFAULT_RIDER_SETTINGS_TIMELINE.bikeWeightKg,
            cyclingLoadAlgorithm:
              (stored.cyclingLoadAlgorithm as "tss" | "hrss") ??
              DEFAULT_RIDER_SETTINGS_TIMELINE.cyclingLoadAlgorithm,
            runningLoadAlgorithm:
              (stored.runningLoadAlgorithm as "rtss" | "hrss") ??
              DEFAULT_RIDER_SETTINGS_TIMELINE.runningLoadAlgorithm,
            swimmingLoadAlgorithm:
              (stored.swimmingLoadAlgorithm as "stss" | "hrss") ??
              DEFAULT_RIDER_SETTINGS_TIMELINE.swimmingLoadAlgorithm,
            initialValues: {
              ftp: stored.initialValues.ftp ?? null,
              weightKg: stored.initialValues.weightKg ?? null,
              restingHr: stored.initialValues.restingHr ?? null,
              maxHr: stored.initialValues.maxHr ?? null,
              lthr: stored.initialValues.lthr ?? null,
              runThresholdPace: stored.initialValues.runThresholdPace ?? null,
              swimThresholdPace: stored.initialValues.swimThresholdPace ?? null,
            },
            changes: stored.changes,
          }
        : DEFAULT_RIDER_SETTINGS_TIMELINE,
    [stored],
  );

  const setTimeline = React.useCallback(
    (newTimeline: RiderSettingsTimeline) => {
      if (athleteId == null) return;
      saveSettings.mutate({
        athleteId,
        cdA: newTimeline.cdA,
        crr: newTimeline.crr,
        bikeWeightKg: newTimeline.bikeWeightKg,
        cyclingLoadAlgorithm: newTimeline.cyclingLoadAlgorithm,
        runningLoadAlgorithm: newTimeline.runningLoadAlgorithm,
        swimmingLoadAlgorithm: newTimeline.swimmingLoadAlgorithm,
        initialValues: newTimeline.initialValues,
        changes: newTimeline.changes,
      });
    },
    [athleteId, saveSettings],
  );

  const resolveForDate = React.useCallback(
    (date: string) => resolveRiderSettings(timeline, date),
    [timeline],
  );

  const currentSettings = React.useMemo(
    () => resolveCurrentRiderSettings(timeline),
    [timeline],
  );

  const hasSettings = stored != null;

  const value = React.useMemo(
    () => ({ timeline, setTimeline, resolveForDate, currentSettings, hasSettings }),
    [timeline, setTimeline, resolveForDate, currentSettings, hasSettings],
  );

  return <RiderSettingsContext value={value}>{children}</RiderSettingsContext>;
}

/** Full timeline access — for the settings page and activity stats. */
export function useRiderSettingsTimeline(): RiderSettingsContextValue {
  return React.useContext(RiderSettingsContext);
}

/** Backward-compatible hook — returns today's resolved settings. */
export function useRiderSettings(): [RiderSettings] {
  const { currentSettings } = React.useContext(RiderSettingsContext);
  return [currentSettings];
}
