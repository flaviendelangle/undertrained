/** Zone-ramp index for each RPE step: easy steps cool, maximal ones hot. */
export const RPE_STEP_RAMP = [1, 1, 1, 2, 2, 3, 3, 4, 4, 5];

/**
 * An RPE in a table cell: the value, then a short bar filled to its share of
 * the 1–10 scale in its step's zone color. The bars share one width, so a
 * column of them reads like a bar chart of the sessions' effort.
 */
export function RpeBar({ rpe }: { rpe: number }) {
  const step = Math.min(10, Math.max(1, Math.round(rpe)));
  return (
    <span className="inline-flex items-center gap-2">
      {rpe}
      <span
        className="bg-foreground/10 relative h-1.5 w-10 shrink-0 overflow-hidden rounded-full"
        aria-hidden
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.min(10, rpe) * 10}%`,
            backgroundColor: `var(--zone-${RPE_STEP_RAMP[step - 1] + 1})`,
          }}
        />
      </span>
    </span>
  );
}
