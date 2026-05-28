import type { Locale as DateFnsLocale } from "date-fns";

import { DATE_FNS_LOCALE, DEFAULT_LOCALE, type Locale } from "./locales";

/**
 * Module-level holder for the active `date-fns` locale.
 *
 * The app is client-rendered (tRPC SSR is disabled and the data-heavy pages
 * are `dynamic(ssr:false)`), so a singleton is a pragmatic way to give the
 * pure, non-React date utilities in `~/utils/dateUtils` a locale without
 * threading one through every call site. `I18nProvider` keeps it in sync with
 * the user's chosen locale via `setActiveDateLocale`.
 */
let activeDateLocale: DateFnsLocale = DATE_FNS_LOCALE[DEFAULT_LOCALE];

export function setActiveDateLocale(locale: Locale): void {
  activeDateLocale = DATE_FNS_LOCALE[locale];
}

export function getActiveDateLocale(): DateFnsLocale {
  return activeDateLocale;
}
