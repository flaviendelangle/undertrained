import { useMemo } from "react";

import type { GetServerSideProps } from "next";
import Link from "next/link";

import { BrowserCompatibilityBanner } from "~/components/liveTraining/BrowserCompatibilityBanner";
import { FtpTestResult } from "~/components/liveTraining/FtpTestResult";
import { RideNavigationDialog } from "~/components/liveTraining/RideNavigationDialog";
import { HudConnectionWizard } from "~/components/liveTraining/hud/HudConnectionWizard";
import { HudMainView } from "~/components/liveTraining/hud/HudMainView";
import { HudPauseOverlay } from "~/components/liveTraining/hud/HudPauseOverlay";
import { HudPostTraining } from "~/components/liveTraining/hud/HudPostTraining";
import { HudWaitingScreen } from "~/components/liveTraining/hud/HudWaitingScreen";
import { QueryState } from "~/components/primitives/QueryState";
import { SettingsCallout } from "~/components/primitives/SettingsCallout";
import { Button } from "~/components/ui/button";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useRideEngine } from "~/hooks/useRideEngine";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
import type { RideWorkout } from "~/liveTraining/rideEngine";
import { downloadFitFile, generateFitFile } from "~/utils/fitFileGenerator";
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

function LiveWorkout({ workout }: { workout: RideWorkout }) {
  const t = useT();
  const { configuredFtp } = useRiderSettingsTimeline();
  const ftpTest = useMemo(
    () => identifyFtpTest(workout.structure),
    [workout.structure],
  );
  const startBlocked =
    hasPowerTarget(workout.structure.nodes, ["pct", "ramp"]) &&
    configuredFtp == null;
  const { engine, ride, player, riderSettings } = useRideEngine({
    workout,
    startSuspended: startBlocked,
  });
  const { phase } = ride;
  const hudWorkout = { name: workout.name, player };

  return (
    <div className="relative h-full overflow-hidden">
      <RideNavigationDialog
        enabled={ride.hasRide}
        onSave={() => {
          const summary = engine.summarize();
          if (summary)
            downloadFitFile(generateFitFile(engine.getDataPoints(), summary));
        }}
      />
      <div className="absolute top-0 right-0 left-0 z-[60] flex flex-col gap-2 p-2">
        <BrowserCompatibilityBanner />
        {(phase === "main" || phase === "paused") &&
          ride.trainer.state !== "connected" && (
            <div
              role="status"
              className="bg-card flex items-center justify-between gap-3 rounded p-3 text-sm"
            >
              <span>{t("liveTraining.trainerDisconnected")}</span>
              <Button
                disabled={ride.trainer.state === "connecting"}
                onClick={() => void engine.connect("trainer")}
              >
                {t(
                  ride.trainer.state === "connecting"
                    ? "liveTraining.reconnecting"
                    : "liveTraining.reconnect",
                )}
              </Button>
            </div>
          )}
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
          currentPower={ride.live.power}
          currentHr={ride.live.heartRate}
          currentCadence={ride.live.cadence}
          currentSpeedKmh={ride.live.speedKmh}
          distanceKm={ride.distanceKm}
          elapsedSeconds={ride.elapsedSeconds}
          chartData={ride.chartData}
          ftp={riderSettings.ftp}
          weightKg={riderSettings.weightKg}
          workout={hudWorkout}
          onPause={engine.pause}
          onStop={engine.stop}
        />
      )}

      {/* Connection wizard */}
      {phase === "connection" && (
        <HudConnectionWizard
          hrState={ride.heartRate.state}
          hrErrorReason={ride.heartRate.errorReason}
          hrDeviceName={ride.heartRate.deviceName}
          hrSource={ride.heartRate.source}
          hrHasDeviceChooser={ride.heartRate.hasDeviceChooser}
          onHrSourceChange={(source) => engine.setSource("heartRate", source)}
          onHrConnect={(options) => void engine.connect("heartRate", options)}
          onHrDisconnect={() => void engine.disconnect("heartRate")}
          trainerState={ride.trainer.state}
          trainerErrorReason={ride.trainer.errorReason}
          trainerDeviceName={ride.trainer.deviceName}
          trainerSource={ride.trainer.source}
          trainerHasDeviceChooser={ride.trainer.hasDeviceChooser}
          onTrainerSourceChange={(source) =>
            engine.setSource("trainer", source)
          }
          onTrainerConnect={(options) =>
            void engine.connect("trainer", options)
          }
          onTrainerDisconnect={() => void engine.disconnect("trainer")}
          onSkipHeartRate={engine.skipHeartRate}
        />
      )}

      {/* Waiting screen */}
      {phase === "waiting" && (
        <HudWaitingScreen
          currentHr={ride.live.heartRate}
          hrConnected={ride.heartRate.state === "connected"}
          onManualStart={engine.start}
          startDisabled={startBlocked}
          ergEnabled={ride.erg.enabled}
          onErgEnabledChange={engine.setErgEnabled}
          supportsControl={ride.trainer.supportsControl}
          ergError={ride.erg.error}
          ergTargetStatus={ride.erg.targetStatus}
          workout={hudWorkout}
        />
      )}

      {/* Pause overlay */}
      {phase === "paused" && (
        <HudPauseOverlay
          pausedSeconds={ride.pausedSeconds}
          workout={hudWorkout}
          onResume={engine.resume}
          onStop={engine.stop}
        />
      )}

      {ftpTest && (player.isFinished || phase === "post") && (
        <FtpTestResult id={ftpTest} points={engine.getDataPoints()} />
      )}

      {/* Post-training slide-up */}
      {phase === "post" && ride.summary && (
        <HudPostTraining
          summary={ride.summary}
          chartData={ride.chartData}
          dataPoints={engine.getDataPoints()}
          ftp={riderSettings.ftp}
          workoutName={workout.name}
          segments={player.segments}
          onReset={engine.reset}
        />
      )}
    </div>
  );
}
