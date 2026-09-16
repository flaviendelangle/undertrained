import { useMemo, useState } from "react";

import type { GetServerSideProps } from "next";
import Link from "next/link";

import { BrowserCompatibilityBanner } from "~/components/liveTraining/BrowserCompatibilityBanner";
import { FtpTestResult } from "~/components/liveTraining/FtpTestResult";
import { HudConnectionWizard } from "~/components/liveTraining/hud/HudConnectionWizard";
import { HudMainView } from "~/components/liveTraining/hud/HudMainView";
import { HudPauseOverlay } from "~/components/liveTraining/hud/HudPauseOverlay";
import { HudPostTraining } from "~/components/liveTraining/hud/HudPostTraining";
import { HudWaitingScreen } from "~/components/liveTraining/hud/HudWaitingScreen";
import { QueryState } from "~/components/primitives/QueryState";
import { SettingsCallout } from "~/components/primitives/SettingsCallout";
import { Button } from "~/components/ui/button";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import type { TrainingPageControllerOptions } from "~/hooks/useTrainingPageController";
import { useTrainingPageController } from "~/hooks/useTrainingPageController";
import { useT } from "~/i18n/useT";
import { isStructuredWorkoutsEnabled } from "~/lib/features";
import {
  type BuiltInWorkoutId,
  builtInWorkout,
  identifyFtpTest,
  isBuiltInWorkoutId,
} from "~/utils/structuredWorkout/builtIn";
import { hasPowerTarget } from "~/utils/structuredWorkout/types";
import { trpc } from "~/utils/trpc";

interface LiveTrainingPageProps {
  /**
   * Deep link from the workouts library or the Journal
   * (`/workouts/live?workoutId=123`). Resolved here rather than in an effect so
   * the ride never flashes as a free ride before the workout loads. Ownership is
   * still enforced server-side by the tRPC procedure that fetches it.
   */
  initialWorkoutId: number | null;
  initialBuiltInId: BuiltInWorkoutId | null;
}

export const getServerSideProps: GetServerSideProps<
  LiveTrainingPageProps
> = async ({ query }) => {
  if (!isStructuredWorkoutsEnabled) return { notFound: true };
  const builtInId = isBuiltInWorkoutId(query.builtinWorkout)
    ? query.builtinWorkout
    : null;
  const raw = query.workoutId;
  const workoutId =
    typeof raw === "string" &&
    /^[1-9]\d*$/.test(raw) &&
    Number.isSafeInteger(Number(raw))
      ? Number(raw)
      : null;
  if (!builtInId && workoutId == null)
    return { redirect: { destination: "/workouts", permanent: false } };
  return {
    props: {
      initialBuiltInId: builtInId,
      initialWorkoutId: builtInId ? null : workoutId,
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
  initialBuiltInId,
}: LiveTrainingPageProps) {
  const t = useT();
  const athleteId = useAthleteId();
  const builtIn = useMemo(
    () => (initialBuiltInId ? builtInWorkout(initialBuiltInId, 200, t) : null),
    [initialBuiltInId, t],
  );
  const detail = trpc.structuredWorkouts.get.useQuery(
    { athleteId: athleteId!, id: initialWorkoutId! },
    { enabled: !!athleteId && initialWorkoutId != null && !builtIn },
  );
  const workout =
    builtIn ?? (detail.data?.id === initialWorkoutId ? detail.data : null);
  if (!workout)
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <QueryState
          loading={!detail.isError}
          error={detail.isError}
          onRetry={() => void detail.refetch()}
        />
        <Button
          nativeButton={false}
          render={<Link href="/workouts" />}
          variant="outline"
        >
          {t("nav.workouts")}
        </Button>
      </div>
    );
  return <LiveWorkout key={workout.id} workout={workout} />;
}

function LiveWorkout({
  workout,
}: {
  workout: TrainingPageControllerOptions["workout"];
}) {
  const t = useT();
  const { configuredFtp } = useRiderSettingsTimeline();
  const ftpTest = useMemo(
    () => identifyFtpTest(workout.structure),
    [workout.structure],
  );
  const startBlocked =
    hasPowerTarget(workout.structure.nodes, ["pct", "ramp"]) &&
    configuredFtp == null;
  const ctrl = useTrainingPageController({
    workout,
    startSuspended: startBlocked,
  });
  // Set once the rider chooses to continue without a heart rate sensor.
  const [hrSkipped, setHrSkipped] = useState(false);
  const phase = getPhase(ctrl, hrSkipped);

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute top-0 right-0 left-0 z-[60] flex flex-col gap-2 p-2">
        <BrowserCompatibilityBanner />
        {startBlocked && (
          <p className="bg-card rounded p-3 text-sm">
            {t("workouts.ftpRequired")}
          </p>
        )}
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
          startDisabled={startBlocked}
          ergEnabled={ctrl.ergMode.ergEnabled}
          onErgEnabledChange={ctrl.ergMode.setErgEnabled}
          supportsControl={ctrl.ergMode.supportsControl}
          ergError={ctrl.ergError}
          ergTargetStatus={ctrl.ergTargetStatus}
          workout={ctrl.workout}
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

      {ftpTest && (ctrl.workout?.player.isFinished || phase === "post") && (
        <FtpTestResult id={ftpTest} points={ctrl.recorder.getDataPoints()} />
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
