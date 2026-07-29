import { useState } from "react";

import type { GetServerSideProps } from "next";

import { SettingsCallout } from "~/components/primitives/SettingsCallout";
import { BrowserCompatibilityBanner } from "~/components/liveTraining/BrowserCompatibilityBanner";
import { HudConnectionWizard } from "~/components/liveTraining/hud/HudConnectionWizard";
import { HudMainView } from "~/components/liveTraining/hud/HudMainView";
import { HudPauseOverlay } from "~/components/liveTraining/hud/HudPauseOverlay";
import { HudPostTraining } from "~/components/liveTraining/hud/HudPostTraining";
import { HudWaitingScreen } from "~/components/liveTraining/hud/HudWaitingScreen";
import { useTrainingPageController } from "~/hooks/useTrainingPageController";
import { useT } from "~/i18n/useT";
import { isLiveTrainingEnabled } from "~/lib/features";

// Live Training is opt-in (see next.config.ts). When it's disabled the route
// is hidden entirely — a direct visit gets a real 404 rather than the page.
export const getServerSideProps: GetServerSideProps = async () => {
  if (!isLiveTrainingEnabled) {
    return { notFound: true };
  }
  return { props: {} };
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

export default function LiveTrainingPage() {
  const t = useT();
  const ctrl = useTrainingPageController();
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
          maxHr={ctrl.riderSettings.maxHr}
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
        />
      )}

      {/* Pause overlay */}
      {phase === "paused" && (
        <HudPauseOverlay
          pausedSeconds={ctrl.session.pausedSeconds}
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
          maxHr={ctrl.riderSettings.maxHr}
          onReset={ctrl.handleReset}
        />
      )}
    </div>
  );
}
