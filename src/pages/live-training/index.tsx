import * as React from "react";
import { useEffect, useRef } from "react";

import { SettingsCallout } from "~/components/primitives/SettingsCallout";
import { BrowserCompatibilityBanner } from "~/components/liveTraining/BrowserCompatibilityBanner";
import { HudConnectionWizard } from "~/components/liveTraining/hud/HudConnectionWizard";
import { HudMainView } from "~/components/liveTraining/hud/HudMainView";
import { HudPauseOverlay } from "~/components/liveTraining/hud/HudPauseOverlay";
import { HudPostTraining } from "~/components/liveTraining/hud/HudPostTraining";
import { HudWaitingScreen } from "~/components/liveTraining/hud/HudWaitingScreen";
import { useTrainingPageController } from "~/hooks/useTrainingPageController";

type Phase = "connection" | "waiting" | "main" | "paused" | "post";

function getPhase(ctrl: ReturnType<typeof useTrainingPageController>): Phase {
  if (ctrl.session.state === "stopped") return "post";
  if (ctrl.session.state === "paused") return "paused";
  if (ctrl.session.state === "running") return "main";
  if (ctrl.hr.state === "connected" && ctrl.trainer.state === "connected")
    return "waiting";
  return "connection";
}

export default function Training1Page() {
  const ctrl = useTrainingPageController();
  const phase = getPhase(ctrl);


  // Track paused duration
  const pauseStartRef = useRef<number | null>(null);
  const pauseListenersRef = useRef(new Set<() => void>());
  const pauseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (ctrl.session.state === "paused") {
      pauseStartRef.current = Date.now();
      pauseIntervalRef.current = setInterval(() => {
        for (const cb of pauseListenersRef.current) cb();
      }, 1000);
    } else {
      pauseStartRef.current = null;
      if (pauseIntervalRef.current) {
        clearInterval(pauseIntervalRef.current);
        pauseIntervalRef.current = null;
      }
      // Notify subscribers so they re-read 0
      for (const cb of pauseListenersRef.current) cb();
    }
    return () => {
      if (pauseIntervalRef.current) clearInterval(pauseIntervalRef.current);
    };
  }, [ctrl.session.state]);

  const pausedSeconds = React.useSyncExternalStore(
    (cb) => {
      pauseListenersRef.current.add(cb);
      return () => pauseListenersRef.current.delete(cb);
    },
    () =>
      pauseStartRef.current != null
        ? Math.floor((Date.now() - pauseStartRef.current) / 1000)
        : 0,
    () => 0,
  );

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute top-0 right-0 left-0 z-[60] flex flex-col gap-2 p-2">
        <BrowserCompatibilityBanner />
        {(phase === "connection" || phase === "waiting") && (
          <SettingsCallout
            hintId="callout-training-equipment"
            message="Set your weight, bike weight, and aerodynamics (CdA, Crr) in Settings for accurate watts/kg and virtual speed."
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
          onPause={ctrl.session.pause}
          onStop={ctrl.handleStop}
        />
      )}

      {/* Connection wizard */}
      {phase === "connection" && (
        <HudConnectionWizard
          hrState={ctrl.hr.state}
          hrDeviceName={ctrl.hr.deviceName}
          hrSource={ctrl.hrSource}
          onHrSourceChange={ctrl.setHrSource}
          onHrConnect={ctrl.hr.connect}
          onHrDisconnect={ctrl.hr.disconnect}
          trainerState={ctrl.trainer.state}
          trainerDeviceName={ctrl.trainer.deviceName}
          trainerSource={ctrl.trainerSource}
          onTrainerSourceChange={ctrl.setTrainerSource}
          onTrainerConnect={ctrl.trainer.connect}
          onTrainerDisconnect={ctrl.trainer.disconnect}
        />
      )}

      {/* Waiting screen */}
      {phase === "waiting" && (
        <HudWaitingScreen
          currentHr={ctrl.currentHr}
          hrConnected={ctrl.hr.state === "connected"}
          onManualStart={() => {
            ctrl.recorder.clear();
            ctrl.session.start();
          }}
          ergEnabled={ctrl.ergMode.ergEnabled}
          onErgEnabledChange={ctrl.ergMode.setErgEnabled}
          targetPower={ctrl.ergMode.targetPower}
          onTargetPowerChange={ctrl.ergMode.setTargetPower}
          supportsControl={ctrl.ergMode.supportsControl}
        />
      )}

      {/* Pause overlay */}
      {phase === "paused" && (
        <HudPauseOverlay
          pausedSeconds={pausedSeconds}
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
          onReset={ctrl.session.reset}
        />
      )}
    </div>
  );
}
