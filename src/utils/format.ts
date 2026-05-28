import { getActiveDateLocale } from "~/i18n/activeDateLocale";

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

/** Compact hours:minutes, e.g. "12h58". `subHour: "min"` renders "45min" instead of "0h45". */
export function formatCompactDuration(
  seconds: number,
  opts?: { subHour?: "h" | "min" },
): string {
  const { h, m } = decomposeSeconds(seconds);
  if (h === 0 && opts?.subHour === "min") return `${m}min`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

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

/**
 * Distance in kilometres, e.g. "12.3 km" (en) / "12,3 km" (fr). The numeric
 * part is locale-formatted via the active `date-fns` locale's BCP-47 code, so
 * the decimal separator follows the user's language.
 */
export function formatKm(meters: number, decimals = 1): string {
  return `${formatNumber(meters / 1000, decimals)} km`;
}

/** Locale-aware number formatting using the active locale's decimal rules. */
export function formatNumber(value: number, decimals = 1): string {
  return new Intl.NumberFormat(getActiveDateLocale().code, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatActivityType(activityType: string): string {
  return activityType.replace(/([A-Z])/g, " $1").trim();
}
