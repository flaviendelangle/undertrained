import type { Locale as DateFnsLocale } from "date-fns";

import { type TFunction, useI18n } from "./I18nProvider";
import type { Locale } from "./locales";

/** Returns the bound translator. The common case for rendering text. */
export function useT(): TFunction {
  return useI18n().t;
}

/** Locale state + the matching `date-fns` locale, for date/number formatting. */
export function useLocale(): {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  dateLocale: DateFnsLocale;
} {
  const { locale, setLocale, dateLocale } = useI18n();
  return { locale, setLocale, dateLocale };
}
