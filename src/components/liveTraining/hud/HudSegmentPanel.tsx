import type { UseWorkoutPlayerResult } from "~/hooks/useWorkoutPlayer";
import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { cn } from "~/lib/utils";
import { formatElapsed } from "~/utils/format";
import {
  cadenceTolerance,
  complianceTolerance,
  formatStepDuration,
} from "~/utils/structuredWorkout";

/**
 * "What am I doing right now": the target, how far off it you are, how long is
 * left in this step, and what comes next.
 *
 * Everything here is sized to be read from a metre away with a heart rate of
 * 170 — hence the oversized target number and the coarse delta colouring.
 */

interface HudSegmentPanelProps {
  player: UseWorkoutPlayerResult;
  currentPower: number | null;
  currentCadence: number | null;
  className?: string;
}

export function HudSegmentPanel({
  player,
  currentPower,
  currentCadence,
  className,
}: HudSegmentPanelProps) {
  const t = useT();
  const tokens = useChartTokens();

  const segment = player.currentSegment;
  if (segment == null) return null;

  const target = player.targetWatts;
  const delta =
    target != null && currentPower != null ? currentPower - target : null;
  const tolerance = target == null ? 0 : complianceTolerance(target);

  const cadence = player.cadenceTarget;
  const cadenceOff =
    cadence != null &&
    currentCadence != null &&
    currentCadence > 0 &&
    Math.abs(currentCadence - cadence) > cadenceTolerance();

  const rep = segment.repeatPath.at(-1);
  const stepProgress =
    segment.durationSeconds > 0
      ? player.secondsIntoSegment / segment.durationSeconds
      : 0;

  return (
    <div
      className={cn(
        "border-border/50 bg-card/70 flex flex-col gap-2 rounded-2xl border p-3 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground text-xs">
          {t("liveTraining.workout.target")}
        </span>
        {rep && (
          <span className="text-muted-foreground text-xs">
            {t("liveTraining.workout.rep", {
              rep: rep.rep + 1,
              reps: rep.reps,
            })}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span
          className="font-mono text-4xl font-bold tabular-nums"
          style={{ color: tokens.zones[segment.zoneIndex] }}
        >
          {target ?? "—"}
        </span>
        <span className="text-muted-foreground text-sm">W</span>
        {delta != null && (
          <span
            className={cn(
              "ml-auto font-mono text-lg tabular-nums",
              Math.abs(delta) <= tolerance
                ? "text-emerald-500"
                : delta > 0
                  ? "text-amber-500"
                  : "text-red-400",
            )}
          >
            {delta > 0 ? "+" : ""}
            {Math.round(delta)} W
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground truncate text-xs">
          {formatStepDuration(segment.durationSeconds)}
          {segment.startPct != null &&
            ` @ ${Math.round(segment.startPct * 100)}%`}
        </span>
        <span className="font-mono text-xl tabular-nums">
          {formatElapsed(
            Math.max(0, Math.ceil(player.secondsRemainingInSegment)),
          )}
        </span>
      </div>

      {/* Step progress: a bar drains far more legibly than a number counts down. */}
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full transition-[width] duration-1000 ease-linear"
          style={{
            width: `${Math.min(100, Math.max(0, stepProgress * 100))}%`,
            backgroundColor: tokens.zones[segment.zoneIndex],
          }}
        />
      </div>

      {cadence && (
        <div
          className={cn(
            "text-xs",
            cadenceOff ? "text-amber-500" : "text-muted-foreground",
          )}
        >
          {t("liveTraining.cadence")} {cadence} rpm
        </div>
      )}
    </div>
  );
}

export function HudNextSegmentChip({
  player,
  className,
}: {
  player: UseWorkoutPlayerResult;
  className?: string;
}) {
  const t = useT();
  const tokens = useChartTokens();
  const next = player.nextSegment;
  if (next == null) return null;

  return (
    <div
      className={cn(
        "border-border/50 bg-card/60 text-muted-foreground flex items-center gap-2 rounded-full border px-3 py-1 text-xs backdrop-blur-sm",
        className,
      )}
    >
      <span>{t("liveTraining.workout.next")}</span>
      <span
        aria-hidden="true"
        className="size-2 rounded-full"
        style={{ backgroundColor: tokens.zones[next.zoneIndex] }}
      />
      <span className="text-foreground">
        {formatStepDuration(next.durationSeconds)}
        {next.startPct != null && ` @ ${Math.round(next.startPct * 100)}%`}
      </span>
      <span>
        {t("liveTraining.workout.inTime", {
          time: formatElapsed(
            Math.max(0, Math.ceil(player.secondsRemainingInSegment)),
          ),
        })}
      </span>
    </div>
  );
}
