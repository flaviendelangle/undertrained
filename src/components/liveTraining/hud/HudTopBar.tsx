import { useT } from "~/i18n/useT";
import { formatElapsed } from "~/utils/format";

interface HudTopBarProps {
  elapsedSeconds: number;
  distanceKm: number;
  speedKmh: number | null;
}

export function HudTopBar({
  elapsedSeconds,
  distanceKm,
  speedKmh,
}: HudTopBarProps) {
  const t = useT();
  return (
    <div className="border-border/30 bg-background/60 flex h-14 items-center justify-between border-b px-6 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs tracking-wider uppercase">
          {t("liveTraining.dist")}
        </span>
        <span className="text-foreground font-mono text-lg">
          {distanceKm.toFixed(2)}
        </span>
        <span className="text-muted-foreground text-xs">km</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-foreground font-mono text-3xl font-bold">
          {formatElapsed(elapsedSeconds)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs tracking-wider uppercase">
          {t("liveTraining.speed")}
        </span>
        <span className="text-foreground font-mono text-lg">
          {speedKmh != null ? speedKmh.toFixed(1) : "--"}
        </span>
        <span className="text-muted-foreground text-xs">km/h</span>
      </div>
    </div>
  );
}
