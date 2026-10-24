import { Label } from "~/components/ui/label";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { workoutChoiceLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import {
  type WorkoutChoice,
  workoutChoicesForSport,
} from "~/utils/sportConfig";

/**
 * Labelled toggle for Strava's workout type (race, long run, workout…), scoped
 * to the choices `sportType` offers. Renders nothing for sports without one.
 */
export function WorkoutChoiceField({
  label,
  sportType,
  value,
  onChange,
}: {
  label: string;
  sportType: string;
  value: WorkoutChoice;
  onChange: (value: WorkoutChoice) => void;
}) {
  const t = useT();
  const choices = workoutChoicesForSport(sportType);
  if (choices == null) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <SegmentedToggle
        size="default"
        ariaLabel={label}
        value={value}
        onChange={onChange}
        options={choices.map((choice) => ({
          value: choice,
          label: workoutChoiceLabel(choice, t),
        }))}
      />
    </div>
  );
}
