import { PowerHrChart } from "~/components/liveTraining/PowerHrChart";
import { useT } from "~/i18n/useT";
import type { SessionDataPoint } from "~/sensors/types";

import { HudMetricTile } from "./HudMetricTile";
import { HudPowerGauge } from "./HudPowerGauge";
import { HudTopBar } from "./HudTopBar";

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
  onPause,
  onStop,
}: HudMainViewProps) {
  const t = useT();
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
        {/* Metrics row — HR and Cadence side by side */}
        <div className="flex justify-center gap-3 px-4 pt-2">
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
        </div>

        {/* Power gauge — centered below */}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <HudPowerGauge power={currentPower} ftp={ftp} weightKg={weightKg} />
        </div>

        {/* Session controls */}
        <div className="flex justify-end gap-2 px-6 pb-4">
          <button
            onClick={onPause}
            className="border-border/50 bg-card/70 hover:bg-accent/70 flex h-12 w-12 items-center justify-center rounded-xl border text-yellow-400 backdrop-blur-sm transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          </button>
          <button
            onClick={onStop}
            className="border-border/50 bg-card/70 hover:bg-accent/70 flex h-12 w-12 items-center justify-center rounded-xl border text-red-400 backdrop-blur-sm transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Desktop layout */}
      <div className="hidden min-h-0 flex-1 flex-col md:flex">
        {/* Gauge + metrics in a capped-width container */}
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 items-center justify-center gap-8 px-8">
          {/* Power gauge */}
          <div className="shrink-0">
            <HudPowerGauge power={currentPower} ftp={ftp} weightKg={weightKg} />
          </div>

          {/* Right metrics stack */}
          <div className="flex flex-col gap-3">
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
          </div>
        </div>

        {/* Session controls — bottom right */}
        <div className="flex justify-end gap-2 px-6 pb-4">
          <button
            onClick={onPause}
            className="border-border/50 bg-card/70 hover:bg-accent/70 flex h-12 w-12 items-center justify-center rounded-xl border text-yellow-400 backdrop-blur-sm transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          </button>
          <button
            onClick={onStop}
            className="border-border/50 bg-card/70 hover:bg-accent/70 flex h-12 w-12 items-center justify-center rounded-xl border text-red-400 backdrop-blur-sm transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Bottom chart strip */}
      {chartData.length > 0 && (
        <div className="border-border/30 bg-background/80 h-48 border-t px-1 py-1 sm:px-4 sm:py-2">
          <PowerHrChart dataPoints={chartData} ftp={ftp} />
        </div>
      )}
    </div>
  );
}
