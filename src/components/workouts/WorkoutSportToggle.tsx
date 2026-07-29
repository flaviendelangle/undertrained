import { BikeIcon, FootprintsIcon } from "lucide-react";

import { Tooltip } from "~/components/primitives/Tooltip";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import type { WorkoutSport } from "~/utils/structuredWorkout";

interface WorkoutSportToggleProps {
  value: WorkoutSport;
  onChange: (sport: WorkoutSport) => void;
}

/**
 * Bike / Run. Run is announced but not yet buildable: run intervals are usually
 * distance-based, which the v1 model deliberately does not carry.
 */
export function WorkoutSportToggle({
  value,
  onChange,
}: WorkoutSportToggleProps) {
  const t = useT();

  const base =
    "flex h-8 items-center gap-1.5 rounded px-3 text-sm transition-colors";

  return (
    <div
      role="group"
      aria-label={t("workouts.sport.label")}
      className="bg-muted inline-flex rounded-md p-0.5"
    >
      <button
        type="button"
        aria-pressed={value === "bike"}
        onClick={() => onChange("bike")}
        className={cn(
          base,
          value === "bike"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <BikeIcon className="size-4" />
        {t("workouts.sport.bike")}
      </button>

      {/* `aria-disabled` rather than `disabled`: a disabled button swallows
          pointer events, so the tooltip explaining *why* would never appear. */}
      <Tooltip label={t("workouts.sport.runUnavailable")} side="bottom">
        <button
          type="button"
          aria-disabled
          onClick={(event) => event.preventDefault()}
          className={cn(base, "text-muted-foreground/50 cursor-not-allowed")}
        >
          <FootprintsIcon className="size-4" />
          {t("workouts.sport.run")}
        </button>
      </Tooltip>
    </div>
  );
}
