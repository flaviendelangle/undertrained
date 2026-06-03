import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Centered status message shown in place of a chart body — empty data, loading,
 * or an error. One consistent treatment so "no data" reads the same everywhere.
 * Render it inside a chart's body (it fills the available height); the caller
 * owns the surrounding card chrome.
 */
export function ChartMessage({
  tone = "muted",
  className,
  children,
}: {
  /** "muted" for empty/loading, "error" for failures. */
  tone?: "muted" | "error";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center px-4 text-center text-sm",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
