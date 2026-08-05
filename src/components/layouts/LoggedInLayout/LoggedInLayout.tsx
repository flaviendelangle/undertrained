import type { ReactNode } from "react";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

import { LinkActivityPrompt } from "~/components/journal/LinkActivityPrompt";
import { DismissedHintsProvider } from "~/hooks/useDismissedHints";
import { ErgModeProvider } from "~/hooks/useErgMode";
import { ExplorerTilesProvider } from "~/hooks/useExplorerTilesToggle";
import { RiderSettingsProvider } from "~/hooks/useRiderSettings";
import { TileStyleProvider } from "~/hooks/useTileStyle";

import { SharedLayout } from "../SharedLayout";
import { MobileBottomBar, NavBar } from "./NavBar";

export const LoggedInLayout = (props: LoggedInLayoutProps) => {
  const { children } = props;
  const { status } = useSession();
  const router = useRouter();

  // While the session is loading, render a minimal shell so that both the
  // server (static generation) and the initial client render produce the same
  // HTML — avoiding React hydration mismatches caused by usePathname(),
  // useCookies(), etc. returning different values on server vs client.
  if (status === "loading") {
    return (
      <SharedLayout>
        <div className="h-screen" />
      </SharedLayout>
    );
  }

  if (status === "unauthenticated") {
    router.replace("/login");
    return (
      <SharedLayout>
        <div className="h-screen" />
      </SharedLayout>
    );
  }

  return (
    <SharedLayout>
      <ExplorerTilesProvider>
        <TileStyleProvider>
          <RiderSettingsProvider>
            <DismissedHintsProvider>
              <ErgModeProvider>
                <div className="flex h-screen">
                  <NavBar />
                  <main className="flex flex-1 flex-col overflow-hidden pb-14 md:pb-0">
                    {children}
                  </main>
                  <MobileBottomBar />
                </div>
                {/* Opens itself on load when a newly imported activity matches a
                    planned training — the app's only self-opening dialog. Note
                    `/toolbox` and `/privacy` nest this layout inside their own,
                    so it remounts on the way there and back; the prompt latches
                    outside React to stay shown-once across that. */}
                <LinkActivityPrompt />
              </ErgModeProvider>
            </DismissedHintsProvider>
          </RiderSettingsProvider>
        </TileStyleProvider>
      </ExplorerTilesProvider>
    </SharedLayout>
  );
};

interface LoggedInLayoutProps {
  children: ReactNode;
}
