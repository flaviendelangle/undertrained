/**
 * Parses the durations riders actually type.
 *
 * A bare number means *minutes*, because that is how workouts are spoken
 * ("twenty at sweet spot", "five by three"). Everything else is explicit:
 * `1:30` / `90s` / `5m` / `1m30` / `1h05` / `1h30m45`.
 *
 * Returns null for anything unparseable, which the field renders as "leave the
 * previous value alone" rather than silently snapping to zero.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, "");
  if (text === "") return null;

  // h:mm:ss / mm:ss
  const colonMatch = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(text);
  if (colonMatch) {
    const [, first, second, third] = colonMatch;
    return third == null
      ? Number(first) * 60 + Number(second)
      : Number(first) * 3600 + Number(second) * 60 + Number(third);
  }

  // 1h, 5m, 90s, 1h05m, 1m30s — every part carrying its own unit.
  const unitMatch = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (unitMatch?.slice(1).some((part) => part != null)) {
    const [, hours, minutes, seconds] = unitMatch;
    return (
      Number(hours ?? 0) * 3600 +
      Number(minutes ?? 0) * 60 +
      Number(seconds ?? 0)
    );
  }

  // `1h30`, `5m30`, `1h30m45` — a trailing bare number after a unit reads as
  // the next unit down, which is how these are spoken. Handled separately from
  // the pattern above, whose parts must each carry a unit: `1m30` leaves a bare
  // `30` there and would otherwise fall through to null, silently discarding a
  // duration the rider had every reason to expect to work.
  const trailingMatch = /^(?:(\d+)h)?(?:(\d+)m)?(\d{1,2})$/.exec(text);
  if (trailingMatch && (trailingMatch[1] != null || trailingMatch[2] != null)) {
    const [, hours, minutes, trailing] = trailingMatch;
    // The bare tail is minutes after an hour, seconds after a minute.
    return minutes != null
      ? Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(trailing)
      : Number(hours) * 3600 + Number(trailing) * 60;
  }

  const bare = /^(\d+(?:\.\d+)?)$/.exec(text);
  if (bare) return Math.round(Number(bare[1]) * 60);

  return null;
}

/** The inverse, for seeding the input: `90` → `"1:30"`, `3900` → `"1:05:00"`. */
export function formatDurationInput(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
