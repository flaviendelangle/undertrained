import type { ReactNode } from "react";

import { TrophyIcon } from "lucide-react";

/**
 * Shared shell for the Records card: a tall card with a bordered header
 * (title + optional controls). Mirrors the layout used by the other Statistics
 * cards (e.g. EddingtonChart).
 */
export function RecordsCardShell({
  title,
  headerStart,
  headerExtra,
  children,
}: {
  title: string;
  /** Controls rendered immediately after the title, on the left. */
  headerStart?: ReactNode;
  /** Controls pinned to the right of the header. */
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-card flex h-192 w-full flex-col rounded-md">
      <div className="border-border flex items-center gap-3 border-b p-4">
        <TrophyIcon className="text-muted-foreground size-4 shrink-0" />
        <h3 className="shrink-0 text-lg font-semibold">{title}</h3>
        {headerStart}
        {headerExtra && <div className="ml-auto">{headerExtra}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

/** Centered placeholder used for empty/loading states inside a Records card. */
export function RecordsEmptyState({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      {message}
    </div>
  );
}
