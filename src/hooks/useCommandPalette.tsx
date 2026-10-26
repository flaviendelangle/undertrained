import * as React from "react";

import nextDynamic from "next/dynamic";

import { platform } from "@base-ui/utils/platform";

const CommandPalette = nextDynamic(
  () =>
    import("~/components/commandPalette/CommandPalette").then(
      (m) => m.CommandPalette,
    ),
  { ssr: false },
);

/** The palette's keyboard shortcut, as this platform writes it. */
export const COMMAND_PALETTE_SHORTCUT = platform.os.apple ? "⌘K" : "Ctrl K";

const CommandPaletteContext = React.createContext<(() => void) | null>(null);

/** Opens the command palette on Ctrl+K / ⌘K, or from `useCommandPalette`. */
export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  // Loaded on first use, then kept mounted so it can animate closed.
  const [loaded, setLoaded] = React.useState(false);
  const show = React.useCallback(() => {
    setLoaded(true);
    setOpen(true);
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing
      )
        return;
      event.preventDefault();
      setLoaded(true);
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CommandPaletteContext value={show}>
      {children}
      {loaded && <CommandPalette open={open} onOpenChange={setOpen} />}
    </CommandPaletteContext>
  );
}

export function useCommandPalette() {
  const open = React.useContext(CommandPaletteContext);
  if (!open)
    throw new Error(
      "useCommandPalette must be used inside CommandPaletteProvider",
    );
  return open;
}
