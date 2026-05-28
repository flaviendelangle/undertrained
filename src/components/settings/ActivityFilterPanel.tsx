import { SearchIcon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useActivityFilter } from "~/hooks/useActivityFilter";
import { useAthleteId } from "~/hooks/useAthleteId";
import type { AppMessageKey } from "~/i18n/I18nProvider";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { getSportConfig } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

const NONE_VALUE = "__none__";

const WORKOUT_TYPE_GROUPS: {
  id: string;
  labelKey: AppMessageKey;
  types: number[];
}[] = [
  { id: "default", labelKey: "settings.filter.workout.default", types: [0, 10] },
  { id: "race", labelKey: "settings.filter.workout.race", types: [1, 11] },
  { id: "longRun", labelKey: "settings.filter.workout.longRun", types: [2] },
  { id: "workout", labelKey: "settings.filter.workout.workout", types: [3, 12] },
  {
    id: "weightTraining",
    labelKey: "settings.filter.workout.weightTraining",
    types: [30],
  },
];

export function ActivityFilterPanel({
  search,
  onSearchChange,
}: {
  /** When provided, a text search field is shown at the top of the panel. */
  search?: string;
  onSearchChange?: (value: string) => void;
} = {}) {
  const t = useT();
  const { allTypes: activityTypes, allWorkoutTypes: workoutTypes } = useActivitiesQuery();
  const filter = useActivityFilter();
  const athleteId = useAthleteId();
  const { data: periods } = trpc.timePeriods.list.useQuery(
    { athleteId: athleteId! },
    { enabled: !!athleteId },
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      {onSearchChange && (
        <div>
          <div className="text-muted-foreground mb-2 text-xs font-medium">
            {t("common.search")}
          </div>
          <div className="border-border focus-within:ring-ring relative flex items-center rounded-md border focus-within:ring-1">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute left-2.5 size-3.5" />
            <input
              type="text"
              placeholder={t("settings.filter.searchPlaceholder")}
              value={search ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              className="placeholder:text-muted-foreground h-8 w-full rounded-md bg-transparent py-1 pr-7 pl-8 text-sm outline-none"
            />
            {search && (
              <button
                onClick={() => onSearchChange("")}
                className="text-muted-foreground hover:text-foreground absolute right-1.5 flex size-4 items-center justify-center"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Time period */}
      {periods && periods.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-2 text-xs font-medium">
            {t("settings.filter.timePeriod")}
          </div>
          <Select
            value={filter.timePeriodId ? String(filter.timePeriodId) : NONE_VALUE}
            onValueChange={(val) => {
              filter.setTimePeriodId(
                val === NONE_VALUE ? undefined : Number(val),
              );
            }}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue>
                {filter.timePeriodId
                  ? periods.find((p) => p.id === filter.timePeriodId)?.name ??
                    t("settings.filter.allTime")
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
        <div className="grid grid-cols-2 gap-1.5">
          {activityTypes?.map((type) => {
            const Icon = getSportConfig(type).icon;
            const active = filter.activityTypes.includes(type);
            return (
              <button
                key={type}
                onClick={() => {
                  const next = active
                    ? filter.activityTypes.filter((t) => t !== type)
                    : [...filter.activityTypes, type];
                  filter.setActivityTypes(next);
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{sportTypeLabel(type, t)}</span>
              </button>
            );
          })}
        </div>
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
          <div className="grid grid-cols-2 gap-1.5">
            {WORKOUT_TYPE_GROUPS.map((group) => {
              const presentTypes = group.types.filter((t) => workoutTypes.includes(t));
              if (presentTypes.length === 0) return null;
              const active = presentTypes.every((t) => filter.workoutTypes.includes(t));
              return (
                <button
                  key={group.id}
                  onClick={() => {
                    const next = active
                      ? filter.workoutTypes.filter((t) => !presentTypes.includes(t))
                      : [...filter.workoutTypes.filter((t) => !presentTypes.includes(t)), ...presentTypes];
                    filter.setWorkoutTypes(next);
                  }}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="truncate">{t(group.labelKey)}</span>
                </button>
              );
            })}
          </div>
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
      {filter.activeFilterCount > 0 && (
        <Button variant="outline" size="sm" onClick={filter.clearAll}>
          {t("settings.filter.clearAll")}
        </Button>
      )}
    </div>
  );
}
