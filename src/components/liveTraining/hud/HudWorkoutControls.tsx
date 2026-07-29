import type { UseWorkoutPlayerResult } from "~/hooks/useWorkoutPlayer";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";

/**
 * In-ride workout controls: intensity bias, ±1 min on the current step, skip,
 * and the two distinct ways out — end the workout but keep riding, or finish
 * the ride entirely.
 */

const BIAS_STEP = 0.01;
const EXTEND_STEP_S = 60;

const BUTTON =
  "border-border/50 bg-card/70 hover:bg-accent/70 text-muted-foreground hover:text-foreground flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-xs backdrop-blur-sm transition-colors";

interface HudWorkoutControlsProps {
  player: UseWorkoutPlayerResult;
  onFinishRide: () => void;
  className?: string;
}

export function HudWorkoutControls({
  player,
  onFinishRide,
  className,
}: HudWorkoutControlsProps) {
  const t = useT();

  if (player.isFinished) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <span className="text-muted-foreground text-xs">
          {t("liveTraining.workout.complete")}
        </span>
        <button
          type="button"
          onClick={onFinishRide}
          className="flex h-9 items-center rounded-lg bg-red-500/90 px-3 text-xs font-medium text-white transition-colors hover:bg-red-500"
        >
          {t("liveTraining.workout.finishRide")}
        </button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <button
        type="button"
        aria-label={t("liveTraining.workout.biasStep", { step: "-1" })}
        onClick={() => player.adjustBias(-BIAS_STEP)}
        className={BUTTON}
      >
        −
      </button>
      <span className="text-muted-foreground min-w-12 text-center font-mono text-xs tabular-nums">
        {Math.round(player.biasPct * 100)}%
      </span>
      <button
        type="button"
        aria-label={t("liveTraining.workout.biasStep", { step: "+1" })}
        onClick={() => player.adjustBias(BIAS_STEP)}
        className={BUTTON}
      >
        +
      </button>

      <button
        type="button"
        aria-label={t("liveTraining.workout.extend", {
          step: `-${EXTEND_STEP_S}`,
        })}
        onClick={() => player.extendSegment(-EXTEND_STEP_S)}
        className={BUTTON}
      >
        −1′
      </button>
      <button
        type="button"
        aria-label={t("liveTraining.workout.extend", {
          step: `+${EXTEND_STEP_S}`,
        })}
        onClick={() => player.extendSegment(EXTEND_STEP_S)}
        className={BUTTON}
      >
        +1′
      </button>
      <button
        type="button"
        aria-label={t("liveTraining.workout.skip")}
        onClick={player.skipSegment}
        className={BUTTON}
      >
        ⏭
      </button>
      {/* Ending the workout is *not* ending the ride: forcing a rider to bin a
          good session to escape a bad workout is the wrong trade. */}
      <button type="button" onClick={player.endWorkout} className={BUTTON}>
        {t("liveTraining.workout.endWorkout")}
      </button>
    </div>
  );
}
