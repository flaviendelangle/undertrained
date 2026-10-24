import { PowerHrChart } from "~/components/liveTraining/PowerHrChart";
import { useT } from "~/i18n/useT";
import type { ErgStatus, WorkoutPlayer } from "~/liveTraining/rideEngine";
import type { SessionDataPoint } from "~/sensors/types";
import { complianceTolerance } from "~/utils/structuredWorkout";

import { HudErgStatus } from "./HudErgStatus";
import { HudMetricTile } from "./HudMetricTile";
import { HudPowerGauge } from "./HudPowerGauge";
import { HudNextSegmentChip, HudSegmentPanel } from "./HudSegmentPanel";
import { HudTopBar } from "./HudTopBar";
import { HudWorkoutBar } from "./HudWorkoutBar";
import { HudWorkoutControls } from "./HudWorkoutControls";

interface HudMainViewProps {
  // Live values
  currentPower: number | null;
  currentHr: number | null;
  currentCadence: number | null;
  currentSpeedKmh: number | null;
  distanceKm: number;
  elapsedSeconds: number;
  chartData: SessionDataPoint[];
  ftp: number;
  weightKg: number;
  /**
   * Structured workout being ridden, or null for a free ride. One optional
   * group rather than a dozen more flat props — and the null case renders the
   * HUD exactly as it was before workouts existed.
   */
  workout?: { name: string; player: WorkoutPlayer } | null;
  /** What the trainer says about the ERG target, shown under the gauge. */
  erg: Pick<ErgStatus, "error" | "targetStatus">;
  // Actions
  onPause: () => void;
  onStop: () => void;
}

export function HudMainView({
  currentPower,
  currentHr,
  currentCadence,
  currentSpeedKmh,
  distanceKm,
  elapsedSeconds,
  chartData,
  ftp,
  weightKg,
  workout = null,
  erg,
  onPause,
  onStop,
}: HudMainViewProps) {
  const t = useT();
  const player = workout?.player ?? null;
  const targetPower = player?.targetWatts ?? null;
  const tolerance =
    targetPower == null ? undefined : complianceTolerance(targetPower);
  const ergStatus = (
    <HudErgStatus
      error={erg.error}
      targetStatus={erg.targetStatus}
      className="border-border/50 bg-card/70 max-w-xs rounded-2xl border px-3 py-1 text-center backdrop-blur-sm"
    />
  );
  // Both layouts are always mounted (CSS picks one), so the pieces they share
  // are built once here.
  const segmentPanel = player && (
    <HudSegmentPanel
      player={player}
      currentPower={currentPower}
      currentCadence={currentCadence}
    />
  );
  const powerGauge = (
    <HudPowerGauge
      power={currentPower}
      ftp={ftp}
      weightKg={weightKg}
      targetPower={targetPower}
      toleranceWatts={tolerance}
    />
  );
  const metricTiles = (
    <>
      <HudMetricTile
        label={t("liveTraining.heartRate")}
        value={currentHr}
        unit="bpm"
        color="#f87171"
      />
      <HudMetricTile
        label={t("liveTraining.cadence")}
        value={currentCadence != null ? Math.round(currentCadence) : null}
        unit="rpm"
        color="#f472b6"
      />
    </>
  );
  const sessionButtons = (
    <>
      <button
        type="button"
        onClick={onPause}
        aria-label={t("liveTraining.pause")}
        className="border-border/50 bg-card/70 hover:bg-accent/70 flex h-12 w-12 items-center justify-center rounded-xl border text-yellow-400 backdrop-blur-sm transition-colors"
      >
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onStop}
        aria-label={t("liveTraining.stop")}
        className="border-border/50 bg-card/70 hover:bg-accent/70 flex h-12 w-12 items-center justify-center rounded-xl border text-red-400 backdrop-blur-sm transition-colors"
      >
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
    </>
  );
  return (
    <div className="from-background to-background absolute inset-0 flex flex-col bg-linear-to-br">
      {/* Top bar */}
      <HudTopBar
        elapsedSeconds={elapsedSeconds}
        distanceKm={distanceKm}
        speedKmh={currentSpeedKmh}
      />

      {/* Main area — mobile: stacked, desktop: absolute positioned */}
      {/* Mobile layout */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        {player && <div className="px-4 pt-2">{segmentPanel}</div>}

        {/* Metrics row — HR and Cadence side by side */}
        <div className="flex justify-center gap-3 px-4 pt-2">{metricTiles}</div>

        {/* Power gauge — centered below */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
          {powerGauge}
          {ergStatus}
          {player && <HudNextSegmentChip player={player} />}
        </div>

        {player && (
          <div className="px-4 pb-2">
            <HudWorkoutControls player={player} onFinishRide={onStop} />
          </div>
        )}

        {/* Session controls */}
        <div className="flex justify-end gap-2 px-6 pb-4">{sessionButtons}</div>
      </div>

      {/* Desktop layout */}
      <div className="hidden min-h-0 flex-1 flex-col md:flex">
        {/* Gauge + metrics in a capped-width container */}
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 items-center justify-center gap-8 px-8">
          {player && (
            <div className="flex w-64 shrink-0 flex-col gap-2">
              {segmentPanel}
              <HudNextSegmentChip player={player} />
            </div>
          )}

          {/* Power gauge */}
          <div className="flex shrink-0 flex-col items-center gap-2">
            {powerGauge}
            {ergStatus}
          </div>

          {/* Right metrics stack */}
          <div className="flex flex-col gap-3">{metricTiles}</div>
        </div>

        {/* Session controls — bottom right */}
        <div className="flex items-center justify-end gap-2 px-6 pb-4">
          {player && (
            <HudWorkoutControls
              player={player}
              onFinishRide={onStop}
              className="mr-auto"
            />
          )}
          {sessionButtons}
        </div>
      </div>

      {/* Workout profile with a playhead — a better use of the bottom strip
          than ten minutes of history, so on a phone it replaces the chart
          entirely rather than stacking with it. */}
      {player && player.segments.length > 0 && (
        <div className="border-border/30 bg-background/80 h-12 shrink-0 border-t px-1 py-1 sm:px-4">
          <HudWorkoutBar
            segments={player.segments}
            progressPct={player.progressPct}
          />
        </div>
      )}

      {/* Bottom chart strip */}
      {chartData.length > 0 && (
        <div
          className={`border-border/30 bg-background/80 h-48 border-t px-1 py-1 sm:px-4 sm:py-2 ${
            player ? "hidden md:block" : ""
          }`}
        >
          <PowerHrChart dataPoints={chartData} ftp={ftp} />
        </div>
      )}
    </div>
  );
}
