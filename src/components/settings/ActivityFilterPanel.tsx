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
import { cn } from "~/lib/utils";
import { formatActivityType } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

const NONE_VALUE = "__none__";

const WORKOUT_TYPE_GROUPS: { label: string; types: number[] }[] = [
  { label: "Default", types: [0, 10] },
  { label: "Race", types: [1, 11] },
  { label: "Long Run", types: [2] },
  { label: "Workout", types: [3, 12] },
  { label: "Weight Training", types: [30] },
];

export function ActivityFilterPanel({
  search,
  onSearchChange,
}: {
  /** When provided, a text search field is shown at the top of the panel. */
  search?: string;
  onSearchChange?: (value: string) => void;
} = {}) {
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
            Search
          </div>
          <div className="border-border focus-within:ring-ring relative flex items-center rounded-md border focus-within:ring-1">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute left-2.5 size-3.5" />
            <input
              type="text"
              placeholder="Search activities..."
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
            Time Period
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
                  ? periods.find((p) => p.id === filter.timePeriodId)?.name ?? "All time"
                  : "All time"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>All time</SelectItem>
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
          <span>Sport Types</span>
          {filter.activityTypes.length > 0 && (
            <button
              onClick={() => filter.setActivityTypes([])}
              className="text-muted-foreground hover:text-foreground text-[10px]"
            >
              Clear
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
                <span className="truncate">{formatActivityType(type)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Workout types */}
      {workoutTypes && workoutTypes.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs font-medium">
            <span>Workout Type</span>
            {filter.workoutTypes.length > 0 && (
              <button
                onClick={() => filter.setWorkoutTypes([])}
                className="text-muted-foreground hover:text-foreground text-[10px]"
              >
                Clear
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
                  key={group.label}
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
                  <span className="truncate">{group.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Hide commutes */}
      <label className="flex cursor-pointer items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">
          Hide commutes
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
          Clear all filters
        </Button>
      )}
    </div>
  );
}
