import Link from "next/link";

import { powerZoneLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { POWER_ZONES } from "~/sensors/types";
import type { WorkoutMetrics } from "~/utils/structuredWorkout";
import {
  MAX_RESOLVED_SEGMENTS,
  formatStepDuration,
} from "~/utils/structuredWorkout";

/** Above this, some head units start refusing or truncating a workout. */
const DEVICE_STEP_ADVISORY = 50;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono text-lg tabular-nums">{value}</span>
    </div>
  );
}

interface WorkoutSummaryPanelProps {
  metrics: WorkoutMetrics;
  segmentCount: number;
  /** null when the athlete has never saved rider settings. */
  ftp: number | null;
}

/**
 * The derived numbers for the workout being edited.
 *
 * Without a saved FTP the watt-denominated figures are hidden rather than shown
 * against the 200 W default — a fabricated TSS is worse than none. IF survives,
 * because NP and FTP scale together and it is therefore FTP-independent.
 */
export function WorkoutSummaryPanel({
  metrics,
  segmentCount,
  ftp,
}: WorkoutSummaryPanelProps) {
  const t = useT();
  const tokens = useChartTokens();

  const zoneTotal = metrics.zoneSeconds.reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label={t("workouts.summary.totalDuration")}
          value={formatStepDuration(metrics.totalSeconds)}
        />
        <Stat
          label={t("workouts.summary.intensityFactor")}
          value={
            metrics.intensityFactor == null
              ? "—"
              : metrics.intensityFactor.toFixed(2)
          }
        />
        <Stat
          label={t("workouts.summary.tss")}
          value={ftp == null || metrics.tss == null ? "—" : String(metrics.tss)}
        />
        <Stat
          label={t("workouts.summary.normalizedPower")}
          value={
            ftp == null || metrics.normalizedPower == null
              ? "—"
              : `${metrics.normalizedPower} W`
          }
        />
      </div>

      {ftp == null ? (
        <p className="text-muted-foreground text-xs">
          <Link href="/settings" className="hover:text-foreground underline">
            {t("workouts.summary.noFtp")}
          </Link>
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          {t("workouts.summary.atFtp", { ftp })}
        </p>
      )}

      {metrics.freeSeconds > 0 && (
        <p className="text-muted-foreground text-xs">
          {t("workouts.summary.freeRideExcluded", {
            duration: formatStepDuration(metrics.freeSeconds),
          })}
        </p>
      )}

      {zoneTotal > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">
            {t("workouts.summary.zoneDistribution")}
          </span>
          {/* A single stacked row of divs — a seven-slice bar does not need a
              charting library. */}
          <div className="bg-muted flex h-3 overflow-hidden rounded-full">
            {metrics.zoneSeconds.map((seconds, index) =>
              seconds === 0 ? null : (
                <div
                  key={index}
                  title={`${powerZoneLabel(index, t)} · ${formatStepDuration(seconds)}`}
                  style={{
                    flexBasis: `${(seconds / zoneTotal) * 100}%`,
                    backgroundColor: tokens.zones[POWER_ZONES[index].ramp],
                  }}
                />
              ),
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            {metrics.zoneSeconds.map((seconds, index) =>
              seconds === 0 ? null : (
                <div key={index} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: tokens.zones[POWER_ZONES[index].ramp],
                    }}
                  />
                  <span className="text-muted-foreground flex-1 truncate">
                    {powerZoneLabel(index, t)}
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatStepDuration(seconds)}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {segmentCount > DEVICE_STEP_ADVISORY &&
        segmentCount <= MAX_RESOLVED_SEGMENTS && (
          <p className="text-muted-foreground text-xs">
            {t("workouts.summary.manyStepsWarning", { count: segmentCount })}
          </p>
        )}
    </div>
  );
}
