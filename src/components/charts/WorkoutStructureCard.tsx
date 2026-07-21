import * as React from "react";

import { ChartCard } from "~/components/ui/chart-card";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
import type { StoredLap } from "~/server/lib/stravaTypes";
import { formatMinutesSeconds } from "~/utils/format";
import {
  type IntervalBlock,
  type StructureIntensity,
  type StructureMetric,
  detectWorkoutStructure,
} from "~/utils/workoutStructure";

interface WorkoutStructureCardProps {
  activityType: string;
  /** Activity start date — used to resolve the rider settings in effect then. */
  startDate: string;
  laps: StoredLap[] | null;
}

/**
 * Plain-text rendering of the interval structure detected from the activity's
 * laps, e.g. "10 × 1:00 @ 280 W (VO2max) — 0:30 recovery @ 100 W (Recovery)".
 * Renders nothing when no structure is detected (steady rides, auto-laps,
 * cycling without power…). Deliberately bare-bones for now: the goal is to
 * evaluate the detection engine on real activities.
 */
export function WorkoutStructureCard({
  activityType,
  startDate,
  laps,
}: WorkoutStructureCardProps) {
  const t = useT();
  const { resolveForDate } = useRiderSettingsTimeline();
  const { ftp, runThresholdPace } = resolveForDate(startDate);

  const structure = React.useMemo(
    () =>
      laps != null && laps.length > 0
        ? detectWorkoutStructure({
            laps,
            activityType,
            riderSettings: { ftp, runThresholdPace },
          })
        : null,
    [laps, activityType, ftp, runThresholdPace],
  );
  if (structure == null) return null;

  return (
    <ChartCard
      title={t("charts.workoutStructure.title")}
      info={t("charts.workoutStructure.hint")}
      height="auto"
    >
      <div className="flex flex-col gap-2 p-4">
        {structure.blocks.map((block, i) => (
          <p key={i} className="font-mono text-sm">
            {formatBlock(
              block,
              structure.metric,
              t("charts.workoutStructure.recovery"),
            )}
          </p>
        ))}
        <p className="text-muted-foreground text-xs">
          {t("charts.workoutStructure.confidence", {
            value: String(Math.round(structure.confidence * 100)),
          })}
          {!structure.confident &&
            ` (${t("charts.workoutStructure.uncertain")})`}
        </p>
      </div>
    </ChartCard>
  );
}

function formatBlock(
  block: IntervalBlock,
  metric: StructureMetric,
  recoveryLabel: string,
): string {
  const reps =
    block.sets != null ? `${block.sets} × ${block.reps}` : `${block.reps}`;
  const work = `${reps} × ${formatMinutesSeconds(block.workDuration)} @ ${formatIntensity(block.work, metric)}`;
  if (block.recoveryDuration == null || block.recovery == null) return work;
  return `${work} — ${formatMinutesSeconds(block.recoveryDuration)} ${recoveryLabel} @ ${formatIntensity(block.recovery, metric)}`;
}

function formatIntensity(
  intensity: StructureIntensity,
  metric: StructureMetric,
): string {
  const value =
    metric === "power"
      ? `${intensity.value} W`
      : `${formatMinutesSeconds(intensity.value)} /km`;
  return intensity.zoneName != null
    ? `${value} (${intensity.zoneName})`
    : value;
}
