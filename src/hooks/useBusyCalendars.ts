import { useCookies } from "react-cookie";

/**
 * Show/hide state for the external-calendar busy overlay, persisted in cookies
 * (per-browser, instant — no server round-trip), mirroring {@link useActivityFilter}.
 * The *existence* of a calendar lives in the DB; whether it's currently shown is
 * pure view state, so toggling never writes to the database or refetches.
 *
 * - `calendars-master`: the master switch. Stored only when turned **off** (the
 *   default is on), so an absent cookie means "show calendars".
 * - `calendars-hidden`: ids of individually hidden calendars.
 */
const MASTER_COOKIE = "calendars-master";
const HIDDEN_COOKIE = "calendars-hidden";

export function useBusyCalendars() {
  const [state, setState] = useCookies([MASTER_COOKIE, HIDDEN_COOKIE]);

  // Default on: only an explicit `false` cookie hides everything.
  const masterEnabled: boolean = state[MASTER_COOKIE] !== false;
  const hiddenIds: number[] = state[HIDDEN_COOKIE] ?? [];

  const setMasterEnabled = (value: boolean) => {
    if (value) {
      // Back to the default — drop the cookie rather than storing `true`.
      setState(MASTER_COOKIE, "", { maxAge: 0 });
    } else {
      setState(MASTER_COOKIE, false);
    }
  };

  const isHidden = (id: number) => hiddenIds.includes(id);

  const setHidden = (id: number, hidden: boolean) => {
    const next = hidden
      ? [...hiddenIds.filter((x) => x !== id), id]
      : hiddenIds.filter((x) => x !== id);
    setState(HIDDEN_COOKIE, next);
  };

  const toggleHidden = (id: number) => setHidden(id, !isHidden(id));

  return {
    masterEnabled,
    hiddenIds,
    isHidden,
    setHidden,
    toggleHidden,
    setMasterEnabled,
  };
}
