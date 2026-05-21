/**
 * Presentation helpers shared by the "Personal bests" page variants:
 * medal colouring for the top three ranks and the empty/loading placeholder.
 */

/** Tailwind classes for a rank badge — gold / silver / bronze for the podium. */
export function getMedalClasses(rank: number): string {
  switch (rank) {
    case 1:
      return "bg-amber-500/20 text-amber-500";
    case 2:
      return "bg-zinc-400/20 text-zinc-400";
    case 3:
      return "bg-orange-700/20 text-orange-600";
    default:
      return "text-muted-foreground";
  }
}

/** Centered placeholder used for empty/loading states inside a Records view. */
export function RecordsEmptyState({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex h-full min-h-48 items-center justify-center text-sm">
      {message}
    </div>
  );
}
