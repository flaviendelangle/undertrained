import { useCookies } from "react-cookie";

const COOKIE_NAMES = [
  "activity-type",
  "workout-type",
  "time-period",
  "hide-commutes",
] as const;

export function useActivityFilter() {
  const [state, setState] = useCookies([...COOKIE_NAMES]);

  const activityTypes: string[] = state["activity-type"] ?? [];
  const workoutTypes: number[] = state["workout-type"] ?? [];
  const timePeriodId: number | undefined = state["time-period"] || undefined;
  // react-cookie JSON-parses values on read, so the boolean we store comes back
  // as a boolean.
  const hideCommutes: boolean = state["hide-commutes"] === true;

  const setActivityTypes = (types: string[]) => {
    setState("activity-type", types);
  };

  const setWorkoutTypes = (types: number[]) => {
    setState("workout-type", types);
  };

  const setTimePeriodId = (value: number | undefined) => {
    if (value) {
      setState("time-period", value);
    } else {
      setState("time-period", "", { maxAge: 0 });
    }
  };

  const setHideCommutes = (value: boolean) => {
    if (value) {
      setState("hide-commutes", true);
    } else {
      setState("hide-commutes", "", { maxAge: 0 });
    }
  };

  const clearAll = () => {
    setState("activity-type", []);
    setState("workout-type", []);
    setState("time-period", "", { maxAge: 0 });
    setState("hide-commutes", "", { maxAge: 0 });
  };

  const activeFilterCount =
    activityTypes.length +
    workoutTypes.length +
    (timePeriodId ? 1 : 0) +
    (hideCommutes ? 1 : 0);

  return {
    activityTypes,
    workoutTypes,
    timePeriodId,
    hideCommutes,
    setActivityTypes,
    setWorkoutTypes,
    setTimePeriodId,
    setHideCommutes,
    clearAll,
    activeFilterCount,
  };
}
