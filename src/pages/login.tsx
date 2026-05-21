import * as React from "react";

import { ActivityIcon, TimerIcon, TrendingUpIcon, GaugeIcon, CogIcon } from "lucide-react";
import { signIn, useSession } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

import stravaButton from "../../public/strava-connect-button-orange.svg";
import { SharedLayout } from "../components/layouts/SharedLayout";
import { NextPageWithLayout } from "./_app";

const LoginPage: NextPageWithLayout = () => {
  const router = useRouter();
  const session = useSession();

  if (session.data?.user) {
    router.replace("/activities");
  }

  if (session.status === "loading") {
    return null;
  }

  return (
    <main className="from-background via-background to-primary/10 relative flex h-screen items-center justify-center overflow-hidden bg-linear-to-br">
      {/* Decorative background element */}
      <ActivityIcon className="text-primary/3 absolute -right-20 -bottom-20 size-112 rotate-12" />

      <div className="relative z-10 flex flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <ActivityIcon className="text-primary size-10" />
            <h1 className="text-foreground text-5xl font-black tracking-tight">
              Undertrained
            </h1>
          </div>
          <p className="text-muted-foreground text-lg">
            Analyze your triathlon performance
          </p>
        </div>

        <button
          className="group relative transition-transform hover:scale-105 active:scale-100"
          onClick={() => signIn("strava", { callbackUrl: "/activities" })}
        >
          <div className="absolute -inset-1 rounded-lg bg-[#FC4C02]/20 opacity-0 blur-md transition-opacity group-hover:opacity-100" />
          <Image
            priority
            src={stravaButton}
            alt="Login with Strava"
            className="relative"
          />
        </button>

        <Link
          href="/toolbox"
          className="border-border bg-card/50 hover:bg-card group/card w-full max-w-md rounded-sm border p-4 transition-colors"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-foreground text-sm font-semibold">Toolbox</span>
            <span className="text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 text-xs">No login required</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: TimerIcon, label: "Pace Calculator" },
              { icon: TrendingUpIcon, label: "Race Predictor" },
              { icon: GaugeIcon, label: "Zone Calculator" },
              { icon: CogIcon, label: "Gear Calculator" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="text-muted-foreground flex items-center gap-2 text-sm">
                <Icon className="size-4 shrink-0" />
                {label}
              </div>
            ))}
          </div>
        </Link>

        <Link
          href="/privacy"
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-3"
        >
          Privacy Policy
        </Link>
      </div>
    </main>
  );
};

LoginPage.getLayout = function getLayout(page) {
  return <SharedLayout>{page}</SharedLayout>;
};

export default LoginPage;
