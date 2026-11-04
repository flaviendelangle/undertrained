/**
 * Medal colouring for the top three ranks, on the activity page's
 * "Personal records" card.
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
