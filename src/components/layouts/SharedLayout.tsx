import type { ReactNode } from "react";

import Head from "next/head";
import Image from "next/image";

import { LocalizationProvider, enUS, frFR } from "@base-ui/plus/localization";

import { PageTitle } from "~/components/PageTitle";
import { ToastProvider } from "~/components/ui/toast";
import { I18nProvider, useI18n } from "~/i18n/I18nProvider";

import stravaBanner from "../../../public/strava-banner.svg";

export const SharedLayout = ({ children }: SharedLayoutProps) => {
  return (
    <I18nProvider>
      <BaseUiPlusProvider>
        <ToastProvider>
          <Head>
            <link rel="icon" href="/favicon.svg" />
          </Head>
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
