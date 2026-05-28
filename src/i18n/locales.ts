import type { Locale as DateFnsLocale } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";
import { fr } from "date-fns/locale/fr";

/**
 * Supported UI locales. The first entry is the default. Each maps to a
 * `date-fns` locale (for date formatting) and is itself a valid BCP-47 tag
 * usable directly with the `Intl.*` APIs (NumberFormat, PluralRules, …).
 */
export const LOCALES = ["en-GB", "fr-FR"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en-GB";

export const DATE_FNS_LOCALE: Record<Locale, DateFnsLocale> = {
  "en-GB": enGB,
  "fr-FR": fr,
};

/** Human label for each locale, shown in the language selector. */
export const LOCALE_LABEL: Record<Locale, string> = {
  "en-GB": "English",
  "fr-FR": "Français",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Pick the best supported locale for a raw BCP-47 tag (e.g. "fr", "fr-CA",
 * "en-US"). Matches on the primary language subtag, falling back to the
 * default. Used to honour `navigator.language` when no explicit choice exists.
 */
export function matchLocale(tag: string | null | undefined): Locale {
  if (!tag) return DEFAULT_LOCALE;
  const lower = tag.toLowerCase();
  const exact = LOCALES.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;
  const lang = lower.split("-")[0];
  const byLang = LOCALES.find((l) => l.toLowerCase().split("-")[0] === lang);
  return byLang ?? DEFAULT_LOCALE;
}
