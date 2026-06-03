import type { ReactElement, ReactNode } from "react";

import type { NextPage } from "next";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import type { AppContext, AppProps, AppType } from "next/app";
import NextApp from "next/app";
import Head from "next/head";
import { CookiesProvider } from "react-cookie";

import { LicenseInfo } from "@mui/x-license";

import { ErrorBoundary } from "~/components/ErrorBoundary";
import { PostHogProvider } from "~/components/PostHogProvider";
import { LoggedInLayout } from "~/components/layouts/LoggedInLayout";
import { TooltipProvider } from "~/components/ui/tooltip";
import "~/styles/globals.css";
import { trpc } from "~/utils/trpc";

LicenseInfo.setLicenseKey(process.env.NEXT_PUBLIC_MUI_X_LICENSE_KEY!);

export type NextPageWithLayout<
  TProps = Record<string, unknown>,
  TInitialProps = TProps,
> = NextPage<TProps, TInitialProps> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
  nonce?: string;
};

const App = (({
  Component,
  pageProps: { session, ...pageProps },
  nonce,
}: AppPropsWithLayout) => {
  const getLayout =
    Component.getLayout ?? ((page) => <LoggedInLayout>{page}</LoggedInLayout>);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <CookiesProvider>
        <SessionProvider session={session}>
          <PostHogProvider>
            <TooltipProvider>
              <ErrorBoundary>
                {getLayout(<Component {...pageProps} />)}
              </ErrorBoundary>
            </TooltipProvider>
          </PostHogProvider>
        </SessionProvider>
      </CookiesProvider>
    </ThemeProvider>
  );
}) as AppType;

App.getInitialProps = async (appContext: AppContext) => {
  const appProps = await NextApp.getInitialProps(appContext);
  const nonce = appContext.ctx.req?.headers?.["x-nonce"] as string | undefined;
  return { ...appProps, nonce };
};

export default trpc.withTRPC(App);
