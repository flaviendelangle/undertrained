import * as React from "react";

import { format } from "date-fns";

import { useAthleteId } from "~/hooks/useAthleteId";
import {
  DEFAULT_RIDER_SETTINGS,
  DEFAULT_RIDER_SETTINGS_TIMELINE,
  type RiderSettings,
  type RiderSettingsTimeline,
} from "~/sensors/types";
import {
  resolveConfiguredFtp,
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
  configuredFtp: number | null;
  saveStatus: "idle" | "pending" | "error" | "success";
  retrySave: () => void;
}

const RiderSettingsContext = React.createContext<RiderSettingsContextValue>({
  timeline: DEFAULT_RIDER_SETTINGS_TIMELINE,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setTimeline: () => {},
  resolveForDate: () => DEFAULT_RIDER_SETTINGS,
  currentSettings: DEFAULT_RIDER_SETTINGS,
  hasSettings: false,
  configuredFtp: null,
  saveStatus: "idle",
  retrySave: () => undefined,
});

export function RiderSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const athleteId = useAthleteId();
  const [draft, setDraft] = React.useState<RiderSettingsTimeline | null>(null);
  const { data: stored } = trpc.riderSettings.get.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );
  const utils = trpc.useUtils();
  const saveSettings = trpc.riderSettings.save.useMutation({
    scope: { id: "rider-settings-save" },
    onSuccess: async () => {
      await utils.riderSettings.get.invalidate();
      // Scores are recomputed in the background — invalidate dependent queries
      // so they refetch once recomputation finishes.
      void utils.activities.list.invalidate();
      void utils.activities.maps.invalidate();
      void utils.analytics.getPowerCurve.invalidate();
      void utils.analytics.getPowerCurveYears.invalidate();
    },
  });

  const timeline: RiderSettingsTimeline = React.useMemo(
    () =>
      draft ??
      (stored
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
        : DEFAULT_RIDER_SETTINGS_TIMELINE),
    [stored, draft],
  );

  const setTimeline = React.useCallback(
    (newTimeline: RiderSettingsTimeline) => {
      if (athleteId == null) return;
      setDraft(newTimeline);
      saveSettings.mutate(
        {
          athleteId,
          cdA: newTimeline.cdA,
          crr: newTimeline.crr,
          bikeWeightKg: newTimeline.bikeWeightKg,
          cyclingLoadAlgorithm: newTimeline.cyclingLoadAlgorithm,
          runningLoadAlgorithm: newTimeline.runningLoadAlgorithm,
          swimmingLoadAlgorithm: newTimeline.swimmingLoadAlgorithm,
          initialValues: newTimeline.initialValues,
          changes: newTimeline.changes,
        },
        { onSuccess: () => setDraft(null) },
      );
    },
    [athleteId, saveSettings],
  );

  const retrySave = React.useCallback(() => {
    if (draft) setTimeline(draft);
  }, [draft, setTimeline]);

  const resolveForDate = React.useCallback(
    (date: string) => resolveRiderSettings(timeline, date),
    [timeline],
  );

  const currentSettings = React.useMemo(
    () => resolveCurrentRiderSettings(timeline),
    [timeline],
  );

  const hasSettings = stored != null;
  const configuredFtp =
    draft != null || hasSettings
      ? resolveConfiguredFtp(timeline, format(new Date(), "yyyy-MM-dd"))
      : null;

  const value = React.useMemo(
    () => ({
      timeline,
      setTimeline,
      resolveForDate,
      currentSettings,
      hasSettings,
      configuredFtp,
      saveStatus: saveSettings.status,
      retrySave,
    }),
    [
      timeline,
      setTimeline,
      resolveForDate,
      currentSettings,
      hasSettings,
      configuredFtp,
      saveSettings.status,
      retrySave,
    ],
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
