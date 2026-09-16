import type { ReactNode } from "react";

export function WorkoutLibraryGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  );
}

/** Shared dimensions for personal workouts and built-in tests. */
export function WorkoutLibraryCard({
  preview,
  children,
}: {
  preview: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="border-border bg-card relative flex min-w-0 flex-col overflow-hidden rounded-lg border">
      <div className="bg-muted/30 h-28 shrink-0">{preview}</div>
      <div className="h-20 min-w-0 shrink-0 p-3">{children}</div>
    </article>
  );
}
