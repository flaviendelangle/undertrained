import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

import {
  CHIP_TOGGLE_CLASS,
  SportTypeToggleGroup,
} from "~/components/SportTypeToggleGroup";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { useActivityFilter } from "~/hooks/useActivityFilter";
import { useActivityFilterOptions } from "~/hooks/useActivityFilterOptions";
import { useAthleteId } from "~/hooks/useAthleteId";
import type { AppMessageKey } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import { type WorkoutKind, workoutTypesOfKind } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

const NONE_VALUE = "__none__";

/** i18n key for each workout kind's filter toggle, in display order. */
const WORKOUT_KIND_LABEL_KEY: Record<WorkoutKind, AppMessageKey> = {
  none: "settings.filter.workout.default",
  race: "settings.filter.workout.race",
  long_run: "settings.filter.workout.longRun",
  workout: "settings.filter.workout.workout",
  weight_training: "settings.filter.workout.weightTraining",
};

// One toggle per kind, matching every sport's `workout_type` for it (a race
// toggle selects both run and ride races).
const WORKOUT_TYPE_GROUPS = (
  Object.keys(WORKOUT_KIND_LABEL_KEY) as WorkoutKind[]
).map((kind) => ({
  id: kind,
  labelKey: WORKOUT_KIND_LABEL_KEY[kind],
  types: workoutTypesOfKind(kind),
}));

export function ActivityFilterPanel({
  search,
  onSearchChange,
}: {
  /** Include the page search in Clear all. */
  search?: string;
  onSearchChange?: (value: string) => void;
} = {}) {
  const t = useT();
  const { allTypes: activityTypes, allWorkoutTypes: workoutTypes } =
    useActivityFilterOptions();
  const filter = useActivityFilter();
  const athleteId = useAthleteId();
  const { data: periods } = trpc.timePeriods.list.useQuery({ athleteId });
  const availableWorkoutGroups = WORKOUT_TYPE_GROUPS.map((group) => ({
    ...group,
    presentTypes: group.types.filter((type) => workoutTypes?.includes(type)),
  })).filter((group) => group.presentTypes.length > 0);
  const groupedWorkoutTypes = new Set(
    availableWorkoutGroups.flatMap((group) => group.presentTypes),
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Time period */}
      {periods && periods.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-2 text-xs font-medium">
            {t("settings.filter.timePeriod")}
          </div>
          <Select
            value={
              filter.timePeriodId ? String(filter.timePeriodId) : NONE_VALUE
            }
            onValueChange={(val) => {
              filter.setTimePeriodId(
                val === NONE_VALUE ? undefined : Number(val),
              );
            }}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue>
                {filter.timePeriodId
                  ? (periods.find((p) => p.id === filter.timePeriodId)?.name ??
                    t("settings.filter.allTime"))
                  : t("settings.filter.allTime")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>
                {t("settings.filter.allTime")}
              </SelectItem>
              {periods.map((period) => (
                <SelectItem key={period.id} value={String(period.id)}>
                  {period.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Sport types */}
      <div>
        <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs font-medium">
          <span>{t("settings.filter.sportTypes")}</span>
          {filter.activityTypes.length > 0 && (
            <button
              onClick={() => filter.setActivityTypes([])}
              className="text-muted-foreground hover:text-foreground text-[10px]"
            >
              {t("settings.filter.clear")}
            </button>
          )}
        </div>
        <SportTypeToggleGroup
          aria-label={t("settings.filter.sportTypes")}
          types={activityTypes ?? []}
          value={filter.activityTypes}
          onValueChange={filter.setActivityTypes}
          className="grid-cols-2"
        />
      </div>

      {/* Workout types */}
      {workoutTypes && workoutTypes.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs font-medium">
            <span>{t("settings.filter.workoutType")}</span>
            {filter.workoutTypes.length > 0 && (
              <button
                onClick={() => filter.setWorkoutTypes([])}
                className="text-muted-foreground hover:text-foreground text-[10px]"
              >
                {t("settings.filter.clear")}
              </button>
            )}
          </div>
          <ToggleGroup
            multiple
            aria-label={t("settings.filter.workoutType")}
            value={availableWorkoutGroups
              .filter((group) =>
                group.presentTypes.every((type) =>
                  filter.workoutTypes.includes(type),
                ),
              )
              .map((group) => group.id)}
            onValueChange={(selectedGroups) => {
              const ungroupedTypes = filter.workoutTypes.filter(
                (type) => !groupedWorkoutTypes.has(type),
              );
              const selectedTypes = availableWorkoutGroups.flatMap((group) => {
                if (selectedGroups.includes(group.id)) {
                  return group.presentTypes;
                }
                const wasFullySelected = group.presentTypes.every((type) =>
                  filter.workoutTypes.includes(type),
                );
                // Keep legacy/partially selected values when another group is
                // toggled; only remove a group that was fully selected.
                return wasFullySelected
                  ? []
                  : group.presentTypes.filter((type) =>
                      filter.workoutTypes.includes(type),
                    );
              });
              filter.setWorkoutTypes([...ungroupedTypes, ...selectedTypes]);
            }}
            className="grid grid-cols-2 gap-1.5"
          >
            {availableWorkoutGroups.map((group) => (
              <Toggle
                key={group.id}
                value={group.id}
                className={CHIP_TOGGLE_CLASS}
              >
                <span className="truncate">{t(group.labelKey)}</span>
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
      )}

      {/* Hide commutes */}
      <label className="flex cursor-pointer items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">
          {t("settings.filter.hideCommutes")}
        </span>
        <Switch
          size="sm"
          checked={filter.hideCommutes}
          onCheckedChange={filter.setHideCommutes}
        />
      </label>

      {/* Clear all */}
      {(filter.activeFilterCount > 0 || !!search) && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            filter.clearAll();
            onSearchChange?.("");
          }}
        >
          {t("settings.filter.clearAll")}
        </Button>
      )}
    </div>
  );
}
