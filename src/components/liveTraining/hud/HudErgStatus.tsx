import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import type { TrainerTargetStatus } from "~/sensors/adapter";

/**
 * What the rider needs to know about the ERG target, if anything: the trainer
 * refused it, or (FE-C only) the gearing can't hold it at this speed.
 */
export function HudErgStatus({
  error,
  targetStatus,
  className,
}: {
  /** Whether the trainer rejected or ignored the last ERG command. */
  error: boolean;
  targetStatus: TrainerTargetStatus;
  className?: string;
}) {
  const t = useT();
  if (error)
    return (
      <p role="alert" className={cn("text-xs text-red-400", className)}>
        {t("liveTraining.ergFailed")}
      </p>
    );
  // The trainer reports it cannot reach the target in this gear.
  if (targetStatus !== "LowSpeed" && targetStatus !== "HighSpeed") return null;
  return (
    <p role="status" className={cn("text-xs text-yellow-500", className)}>
      {t(
        targetStatus === "LowSpeed"
          ? "liveTraining.ergShiftUp"
          : "liveTraining.ergShiftDown",
      )}
    </p>
  );
}
