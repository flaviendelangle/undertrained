import * as React from "react";

import type { Locale as DateFnsLocale } from "date-fns";
import { useCookies } from "react-cookie";

import { useAthleteId } from "~/hooks/useAthleteId";
import { trpc } from "~/utils/trpc";

import { setActiveDateLocale } from "./activeDateLocale";
import {
  DATE_FNS_LOCALE,
  DEFAULT_LOCALE,
  type Locale,
  isLocale,
  matchLocale,
} from "./locales";
import en, { type Messages } from "./messages/en";
import fr from "./messages/fr";
import { type MessageKey, type MessageParams, translate } from "./t";

const CATALOGS: Record<Locale, Messages> = {
  "en-GB": en,
  "fr-FR": fr,
};

const LOCALE_COOKIE = "locale";
// Persist the cookie for a year and across the whole app.
const COOKIE_OPTIONS = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };

/** Dot-path key into the message catalog, e.g. "journal.dialog.title". */
export type AppMessageKey = MessageKey<Messages>;

export type TFunction = (key: AppMessageKey, params?: MessageParams) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  dateLocale: DateFnsLocale;
  t: TFunction;
}

const I18nContext = React.createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setLocale: () => {},
  dateLocale: DATE_FNS_LOCALE[DEFAULT_LOCALE],
  t: (key) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Start from the default on both server and first client render so hydration
  // matches; the cookie/DB-derived locale is applied in an effect after mount.
  const [locale, setLocaleState] = React.useState<Locale>(DEFAULT_LOCALE);
  const [cookies, setCookie] = useCookies([LOCALE_COOKIE]);

  const athleteId = useAthleteId();
  const { data: dbLanguage } = trpc.account.getLanguage.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );

  const cookieLocale = cookies[LOCALE_COOKIE];

  // Resolve the active locale once the client is mounted: an explicit cookie
  // wins, then the persisted DB preference, then the browser language. This
  // runs post-mount on purpose — rendering the default first keeps the server
  // and initial client HTML identical (the codebase avoids useCookies-driven
  // hydration mismatches the same way; see LoggedInLayout), so this one-time
  // setState is intentional rather than a cascading-render smell.
  React.useEffect(() => {
    const resolved = isLocale(cookieLocale)
      ? cookieLocale
      : isLocale(dbLanguage)
        ? dbLanguage
        : matchLocale(navigator.language);
    setActiveDateLocale(resolved);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocaleState(resolved);
  }, [cookieLocale, dbLanguage]);

  const setLanguage = trpc.account.setLanguage.useMutation();

  const setLocale = React.useCallback(
    (next: Locale) => {
      setLocaleState(next);
      setActiveDateLocale(next);
      setCookie(LOCALE_COOKIE, next, COOKIE_OPTIONS);
      if (athleteId != null) {
        setLanguage.mutate({ athleteId, language: next });
      }
    },
    [setCookie, athleteId, setLanguage],
  );

  const t = React.useCallback<TFunction>(
    (key, params) =>
      translate(CATALOGS[locale], en, locale, key, params),
    [locale],
  );

  const value = React.useMemo<I18nContextValue>(
    () => ({ locale, setLocale, dateLocale: DATE_FNS_LOCALE[locale], t }),
    [locale, setLocale, t],
  );

  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18nContextValue {
  return React.useContext(I18nContext);
}
