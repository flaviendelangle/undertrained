import type { ReactNode } from "react";

import Head from "next/head";
import Image from "next/image";

import { LocalizationProvider, enUS, frFR } from "@base-ui/plus/localization";

import { PageTitle } from "~/components/PageTitle";
import { ToastProvider } from "~/components/ui/toast";
import { useTheme } from "~/hooks/useTheme";
import { I18nProvider, useI18n } from "~/i18n/I18nProvider";

import stravaBanner from "../../../public/strava-banner.svg";

export const SharedLayout = ({ children }: SharedLayoutProps) => {
  return (
    <I18nProvider>
      <BaseUiPlusProvider>
        <ToastProvider>
          <Head>
            <link rel="icon" href="/favicon.svg" />
            <link rel="manifest" href="/manifest.webmanifest" />
          </Head>
          <ThemeColor />
          <PageTitle />

          <div className="h-screen">{children}</div>
          <span className="bg-background absolute right-0 bottom-0 hidden rounded-tl-lg md:block">
            <Image
              priority
              src={stravaBanner}
              alt="This app is powered by Strava"
            />
          </span>
        </ToastProvider>
      </BaseUiPlusProvider>
    </I18nProvider>
  );
};

// The `--background` colors from globals.css in hex, for the browser chrome.
// public/manifest.webmanifest uses the dark one.
const THEME_COLORS = { light: "#f9fafb", dark: "#25292e" };

/**
 * Tints the browser UI (the Android status bar once installed) with the page
 * background. The server doesn't know the theme, so it falls back to the
 * system preference; the client then follows the theme picked in the app.
 */
function ThemeColor() {
  const { resolvedTheme } = useTheme();

  if (resolvedTheme !== "light" && resolvedTheme !== "dark") {
    // Keys stop next/head from deduping the two metas by name.
    return (
      <Head>
        <meta
          key="theme-color-light"
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content={THEME_COLORS.light}
        />
        <meta
          key="theme-color-dark"
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content={THEME_COLORS.dark}
        />
      </Head>
    );
  }

  return (
    <Head>
      <meta name="theme-color" content={THEME_COLORS[resolvedTheme]} />
    </Head>
  );
}

function BaseUiPlusProvider({ children }: { children: ReactNode }) {
  const { locale, dateLocale } = useI18n();
  return (
    <LocalizationProvider
      translations={locale === "fr-FR" ? frFR : enUS}
      temporalLocale={dateLocale}
    >
      {children}
    </LocalizationProvider>
  );
}

interface SharedLayoutProps {
  children: ReactNode;
}
