/**
 * Standard cycling power durations (seconds), mirroring Strava's set. `seconds`
 * is the lookup key stored in `activities.power_bests`; `label` is the UI chip.
 *
 * Shared by the Personal Bests explorer (the duration picker) and the Journal
 * PR badges so both surface the exact same set of power records.
 */
export const CYCLING_POWER_DURATIONS: { seconds: number; label: string }[] = [
  { seconds: 5, label: "5 s" },
  { seconds: 15, label: "15 s" },
  { seconds: 30, label: "30 s" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 180, label: "3 min" },
  { seconds: 300, label: "5 min" },
  { seconds: 480, label: "8 min" },
  { seconds: 600, label: "10 min" },
  { seconds: 900, label: "15 min" },
  { seconds: 1200, label: "20 min" },
  { seconds: 1800, label: "30 min" },
  { seconds: 2700, label: "45 min" },
  { seconds: 3600, label: "1 h" },
  { seconds: 7200, label: "2 h" },
  { seconds: 10800, label: "3 h" },
];
