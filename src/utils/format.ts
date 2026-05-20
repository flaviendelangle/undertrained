function decomposeSeconds(seconds: number): {
  h: number;
  m: number;
  s: number;
} {
  const abs = Math.floor(Math.abs(seconds));
  return {
    h: Math.floor(abs / 3600),
    m: Math.floor((abs % 3600) / 60),
    s: abs % 60,
  };
}

export const formatDuration = (seconds: number) => {
  const { h, m, s } = decomposeSeconds(seconds);
  return [h % 24, m, s]
    .map((value) => (value > 9 ? value : `0${value}`))
    .join(":");
};

export const formatHumanDuration = (seconds: number) => {
  const { h, m, s } = decomposeSeconds(seconds);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
};

/** Compact elapsed time: "1:02:03" or "2:03" (no leading zero on hours/minutes). */
export function formatElapsed(seconds: number): string {
  const { h, m, s } = decomposeSeconds(seconds);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Minutes:seconds from a duration, e.g. "4:05". Stays m:ss even past an hour. */
export function formatMinutesSeconds(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

export function formatActivityType(activityType: string): string {
  return activityType.replace(/([A-Z])/g, " $1").trim();
}
