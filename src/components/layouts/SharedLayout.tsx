import type { ReactNode } from "react";

import Head from "next/head";
import Image from "next/image";

import { PageTitle } from "~/components/PageTitle";
import { I18nProvider } from "~/i18n/I18nProvider";

import stravaBanner from "../../../public/strava-banner.svg";

export const SharedLayout = ({ children }: SharedLayoutProps) => {
  return (
    <I18nProvider>
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
    </I18nProvider>
  );
};

interface SharedLayoutProps {
  children: ReactNode;
}
