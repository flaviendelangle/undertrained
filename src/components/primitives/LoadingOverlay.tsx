import { cn } from "~/lib/utils";

import { LoadingBar } from "./LoadingBar";

/**
 * Full-cover loading overlay that fades out once `hidden` becomes true. Sits on
 * top of an already-mounted view (requires a `relative` ancestor) and reveals
 * it underneath without layout shift. Holds a thin indeterminate
 * {@link LoadingBar} to keep the loading state visually light.
 *
 * Uses `z-20` so it covers page content (map `z-0`, hints `z-10`) but stays
 * below the fixed mobile bottom nav (`z-30`) — the loading state blocks the
 * content, never navigation.
 */
export function LoadingOverlay({
  hidden,
  className,
}: {
  hidden: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden={hidden}
      className={cn(
        "bg-background absolute inset-0 z-20 flex items-start justify-stretch transition-opacity duration-500",
        hidden && "pointer-events-none opacity-0",
        className,
      )}
    >
      <LoadingBar />
    </div>
  );
}
