import * as React from "react";

import { Popover } from "@base-ui/react/popover";

import { SyncPanel } from "~/components/SyncPanel";

import { useIsMobile } from "./useIsMobile";

export const SYNC_TRIGGER_ID = "navigation-sync";
const SyncPanelContext = React.createContext<{
  open: () => void;
  handle: Popover.Handle<unknown>;
} | null>(null);
export function SyncPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [handle] = React.useState(() => Popover.createHandle());
  const mobile = useIsMobile();
  const openPanel = React.useCallback(() => {
    if (mobile) setOpen(true);
    else handle.open(SYNC_TRIGGER_ID);
  }, [mobile, handle]);
  return (
    <SyncPanelContext value={{ open: openPanel, handle }}>
      {children}
      <SyncPanel open={open} onOpenChange={setOpen} handle={handle} />
    </SyncPanelContext>
  );
}
function useSyncPanelContext() {
  const context = React.useContext(SyncPanelContext);
  if (!context)
    throw new Error("useSyncPanel must be used inside SyncPanelProvider");
  return context;
}
export function useSyncPanel() {
  return useSyncPanelContext().open;
}
export function useSyncPanelHandle() {
  return useSyncPanelContext().handle;
}
