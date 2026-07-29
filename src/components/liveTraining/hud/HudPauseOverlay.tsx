import { Button } from "~/components/ui/button";
import type { UseWorkoutPlayerResult } from "~/hooks/useWorkoutPlayer";
import { useT } from "~/i18n/useT";
import { formatElapsed } from "~/utils/format";

interface HudPauseOverlayProps {
  pausedSeconds: number;
  workout?: { name: string; player: UseWorkoutPlayerResult } | null;
  onResume: () => void;
  onStop: () => void;
}

export function HudPauseOverlay({
  pausedSeconds,
  workout = null,
  onResume,
  onStop,
}: HudPauseOverlayProps) {
  const t = useT();
  const player = workout?.player ?? null;
  return (
    <div className="bg-background/70 absolute inset-0 z-50 flex items-center justify-center backdrop-blur-md">
      <div className="flex flex-col items-center gap-6">
        <span className="text-foreground/80 text-6xl font-black tracking-widest">
          {t("liveTraining.paused")}
        </span>
        <span className="text-muted-foreground font-mono text-2xl">
          {formatElapsed(pausedSeconds)}
        </span>
        {/* Where the rider will pick up again — the first thing you want to
            know when you come back to the bike. */}
        {player?.currentSegment && (
          <span className="text-muted-foreground text-sm">
            {t("liveTraining.workout.segmentProgress", {
              index: player.segmentIndex + 1,
              total: player.segments.length,
            })}{" "}
            ·{" "}
            {t("liveTraining.workout.remaining", {
              time: formatElapsed(
                Math.max(0, Math.ceil(player.secondsRemainingInSegment)),
              ),
            })}
          </span>
        )}
        <div className="mt-4 flex gap-4">
          <Button
            onClick={onResume}
            className="bg-green-600 px-8 py-3 text-lg font-bold hover:bg-green-500"
          >
            {t("liveTraining.resume")}
          </Button>
          <Button
            variant="destructive"
            onClick={onStop}
            className="px-8 py-3 text-lg font-bold"
          >
            {t("liveTraining.stop")}
          </Button>
        </div>
      </div>
    </div>
  );
}
