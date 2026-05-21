import { cn } from "~/lib/utils";

/**
 * Thin indeterminate progress bar. Kept visually light and zero-height-impact
 * so it can sit at the top of a loading view without causing layout shift.
 */
export function LoadingBar({ className }: { className?: string }) {
  return (
    <div
      role="progressbar"
      aria-busy
      className={cn("bg-muted/60 h-0.5 w-full overflow-hidden", className)}
    >
      <div className="bg-primary animate-indeterminate-progress h-full w-1/4" />
    </div>
  );
}
