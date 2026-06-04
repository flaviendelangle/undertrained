/**
 * Floating-local ↔ absolute-UTC conversions anchored to an IANA timezone.
 *
 * Shared by the *outgoing* planned-training iCal feed (`api/calendar/[token].ts`,
 * which converts stored floating wall-clock plan times to absolute UTC instants
 * subscribed calendars honour) and the *incoming* external-calendar parser
 * (`icalFeed.ts`, which does the reverse so feed events land on the Journal grid).
 * Both directions are DST-aware via `Intl`, so neither side has to trust a
 * calendar client's timezone guess.
 */

/** Milliseconds `timeZone` is ahead of UTC at the given absolute instant. */
export function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const f = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    f("year"),
    f("month") - 1,
    f("day"),
    f("hour"),
    f("minute"),
    f("second"),
  );
  return asUtc - utcMs;
}

/**
 * Resolve a floating wall-clock datetime (e.g. "2026-05-25T07:00:00", no offset)
 * to the absolute UTC instant it denotes in `timeZone`. DST-aware via `Intl` —
 * the second pass corrects the offset when the first guess lands on the far side
 * of a DST transition. Stored plan times are floating, so this anchors them to
 * the athlete's zone rather than letting the calendar guess (Google assumes UTC).
 */
export function zonedWallClockToUtc(floating: string, timeZone: string): Date {
  const [datePart, timePart = "00:00:00"] = floating.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi, s] = timePart.slice(0, 8).split(":").map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  let utc = wallAsUtc - tzOffsetMs(wallAsUtc, timeZone);
  utc = wallAsUtc - tzOffsetMs(utc, timeZone);
  return new Date(utc);
}

/**
 * Inverse of {@link zonedWallClockToUtc}: render an absolute instant as the
 * floating wall-clock datetime (`YYYY-MM-DDTHH:mm:ss`, no offset) it shows as in
 * `timeZone`. External-calendar feeds carry absolute instants; the Journal grid
 * positions everything by floating-local minutes (see `weekGrid.minutesFromIso`),
 * so every incoming event is funnelled through this.
 */
export function utcToZonedWallClock(instant: Date, timeZone: string): string {
  const local = new Date(instant.getTime() + tzOffsetMs(instant.getTime(), timeZone));
  return local.toISOString().slice(0, 19);
}
