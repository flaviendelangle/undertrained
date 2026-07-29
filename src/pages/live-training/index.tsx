import { useState } from "react";

import type { GetServerSideProps } from "next";

import { BrowserCompatibilityBanner } from "~/components/liveTraining/BrowserCompatibilityBanner";
import { WorkoutPickerDialog } from "~/components/liveTraining/WorkoutPickerDialog";
import { HudConnectionWizard } from "~/components/liveTraining/hud/HudConnectionWizard";
import { HudMainView } from "~/components/liveTraining/hud/HudMainView";
import { HudPauseOverlay } from "~/components/liveTraining/hud/HudPauseOverlay";
import { HudPostTraining } from "~/components/liveTraining/hud/HudPostTraining";
import { HudWaitingScreen } from "~/components/liveTraining/hud/HudWaitingScreen";
import { SettingsCallout } from "~/components/primitives/SettingsCallout";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useTrainingPageController } from "~/hooks/useTrainingPageController";
import { useT } from "~/i18n/useT";
import {
  isLiveTrainingEnabled,
  isStructuredWorkoutsEnabled,
} from "~/lib/features";
import { trpc } from "~/utils/trpc";

// Live Training is opt-in (see next.config.ts). When it's disabled the route
// is hidden entirely — a direct visit gets a real 404 rather than the page.
interface LiveTrainingPageProps {
  /**
   * Deep link from the workouts library or the Journal
   * (`/live-training?workoutId=123`). Resolved here rather than in an effect so
   * the ride never flashes as a free ride before the workout loads. Ownership is
   * still enforced server-side by the tRPC procedure that fetches it.
   */
  initialWorkoutId: number | null;
}

export const getServerSideProps: GetServerSideProps<
  LiveTrainingPageProps
> = async ({ query }) => {
  if (!isLiveTrainingEnabled) {
    return { notFound: true };
  }
  const raw = Array.isArray(query.workoutId)
    ? query.workoutId[0]
    : query.workoutId;
  const parsed = raw != null ? Number(raw) : Number.NaN;
  return {
    props: {
      initialWorkoutId:
        isStructuredWorkoutsEnabled && Number.isFinite(parsed) ? parsed : null,
    },
  };
};

type Phase = "connection" | "waiting" | "main" | "paused" | "post";

/**
 * Only the trainer is required to ride: heart rate is optional everywhere
 * downstream (the summary, the chart and the FIT record all handle a missing
 * HR), so gating the wizard on it locked out anyone without a strap.
 */
function getPhase(
  ctrl: ReturnType<typeof useTrainingPageController>,
  hrSkipped: boolean,
): Phase {
  if (ctrl.session.state === "stopped") return "post";
  if (ctrl.session.state === "paused") return "paused";
  if (ctrl.session.state === "running") return "main";
  if (ctrl.trainer.state === "connected") {
    if (hrSkipped || ctrl.hr.state === "connected") return "waiting";
  }
  return "connection";
}

export default function LiveTrainingPage({
  initialWorkoutId,
}: LiveTrainingPageProps) {
  const t = useT();
  const athleteId = useAthleteId();
  const [workoutId, setWorkoutId] = useState<number | null>(initialWorkoutId);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: workoutRow } = trpc.structuredWorkouts.get.useQuery(
    { athleteId: athleteId!, id: workoutId! },
    { enabled: !!athleteId && workoutId != null },
  );
  // Only hand the controller a workout once it has actually loaded, so a slow
  // fetch never leaves the player pointing at a stale tree.
  const workout =
    workoutId != null && workoutRow?.id === workoutId ? workoutRow : null;

  const ctrl = useTrainingPageController({
    workout,
    autoStartSuspended: pickerOpen,
  });
  // Set once the rider chooses to continue without a heart rate sensor.
  const [hrSkipped, setHrSkipped] = useState(false);
  const phase = getPhase(ctrl, hrSkipped);

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute top-0 right-0 left-0 z-[60] flex flex-col gap-2 p-2">
        <BrowserCompatibilityBanner />
        {(phase === "connection" || phase === "waiting") && (
          <SettingsCallout
            hintId="callout-training-equipment"
            message={t("liveTraining.equipmentCallout")}
          />
        )}
      </div>

      {/* Main training view (always mounted when running/paused so it freezes behind overlays) */}
      {(phase === "main" || phase === "paused") && (
        <HudMainView
          currentPower={ctrl.currentPower}
          currentHr={ctrl.currentHr}
          currentCadence={ctrl.currentCadence}
          currentSpeedKmh={ctrl.currentSpeedKmh}
          distanceKm={ctrl.distanceKm}
          elapsedSeconds={ctrl.session.elapsedSeconds}
          chartData={ctrl.chartData}
          ftp={ctrl.riderSettings.ftp}
          weightKg={ctrl.riderSettings.weightKg}
          workout={ctrl.workout}
          onPause={ctrl.session.pause}
          onStop={ctrl.handleStop}
        />
      )}

      {/* Connection wizard */}
      {phase === "connection" && (
        <HudConnectionWizard
          hrState={ctrl.hr.state}
          hrErrorReason={ctrl.hr.errorReason}
          hrDeviceName={ctrl.hr.deviceName}
          hrSource={ctrl.hrSource}
          onHrSourceChange={ctrl.setHrSource}
          onHrConnect={ctrl.hr.connect}
          onHrDisconnect={ctrl.hr.disconnect}
          trainerState={ctrl.trainer.state}
          trainerErrorReason={ctrl.trainer.errorReason}
          trainerDeviceName={ctrl.trainer.deviceName}
          trainerSource={ctrl.trainerSource}
          onTrainerSourceChange={ctrl.setTrainerSource}
          onTrainerConnect={ctrl.trainer.connect}
          onTrainerDisconnect={ctrl.trainer.disconnect}
          onSkipHeartRate={() => setHrSkipped(true)}
        />
      )}

      {/* Waiting screen */}
      {phase === "waiting" && (
        <HudWaitingScreen
          currentHr={ctrl.currentHr}
          hrConnected={ctrl.hr.state === "connected"}
          onManualStart={ctrl.startSession}
          ergEnabled={ctrl.ergMode.ergEnabled}
          onErgEnabledChange={ctrl.ergMode.setErgEnabled}
          targetPower={ctrl.ergMode.targetPower}
          onTargetPowerChange={ctrl.ergMode.setTargetPower}
          supportsControl={ctrl.ergMode.supportsControl}
          ergError={ctrl.ergError}
          ergTargetStatus={ctrl.ergTargetStatus}
          workout={ctrl.workout}
          onPickWorkout={() => setPickerOpen(true)}
          onClearWorkout={() => setWorkoutId(null)}
        />
      )}

      {isStructuredWorkoutsEnabled && (
        <WorkoutPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={setWorkoutId}
        />
      )}

      {/* Pause overlay */}
      {phase === "paused" && (
        <HudPauseOverlay
          pausedSeconds={ctrl.session.pausedSeconds}
          workout={ctrl.workout}
          onResume={ctrl.session.resume}
          onStop={ctrl.handleStop}
        />
      )}

      {/* Post-training slide-up */}
      {phase === "post" && ctrl.recorder.summary && (
        <HudPostTraining
          summary={ctrl.recorder.summary}
          chartData={ctrl.chartData}
          dataPoints={ctrl.recorder.getDataPoints()}
          ftp={ctrl.riderSettings.ftp}
          workoutName={ctrl.workout?.name ?? null}
          segments={ctrl.workout?.player.segments ?? null}
          onReset={ctrl.handleReset}
        />
      )}
    </div>
  );
}
