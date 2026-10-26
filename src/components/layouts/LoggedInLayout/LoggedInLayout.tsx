import type { ReactNode } from "react";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

import { LinkActivityPrompt } from "~/components/journal/LinkActivityPrompt";
import { ActivityViewProvider } from "~/hooks/useActivityView";
import { AthleteIdContext } from "~/hooks/useAthleteId";
import { CommandPaletteProvider } from "~/hooks/useCommandPalette";
import { DismissedHintsProvider } from "~/hooks/useDismissedHints";
import { ExplorerTilesProvider } from "~/hooks/useExplorerTilesToggle";
import { RiderSettingsProvider } from "~/hooks/useRiderSettings";
import { SyncPanelProvider } from "~/hooks/useSyncPanel";
import { TileStyleProvider } from "~/hooks/useTileStyle";

import { SharedLayout } from "../SharedLayout";
import { MobileBottomBar, NavBar } from "./NavBar";

export const LoggedInLayout = (props: LoggedInLayoutProps) => {
  const { children } = props;
  const { data: session, status } = useSession();
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

  if (status !== "authenticated") {
    router.replace("/login");
    return (
      <SharedLayout>
        <div className="h-screen" />
      </SharedLayout>
    );
  }

  return (
    <SharedLayout>
      <AthleteIdContext value={session.athleteId}>
        <SyncPanelProvider>
          <ActivityViewProvider>
            <ExplorerTilesProvider>
              <TileStyleProvider>
                <RiderSettingsProvider>
                  <DismissedHintsProvider>
                    <CommandPaletteProvider>
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
                    </CommandPaletteProvider>
                  </DismissedHintsProvider>
                </RiderSettingsProvider>
              </TileStyleProvider>
            </ExplorerTilesProvider>
          </ActivityViewProvider>
        </SyncPanelProvider>
      </AthleteIdContext>
    </SharedLayout>
  );
};

interface LoggedInLayoutProps {
  children: ReactNode;
}
