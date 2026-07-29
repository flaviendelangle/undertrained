import * as React from "react";

import { MinusIcon, PlusIcon } from "lucide-react";

import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { MIN_STEP_SECONDS } from "~/utils/structuredWorkout";

import { formatDurationInput, parseDuration } from "./parseDuration";

/** How much a stepper tap moves the duration. */
const STEP_SECONDS = 15;

interface DurationFieldProps {
  seconds: number;
  onChange: (seconds: number) => void;
  className?: string;
}

/**
 * A duration input that accepts what riders type — `1:30`, `90s`, `5m`, or a
 * bare `5` for five minutes — plus ±15 s steppers for nudging.
 *
 * The text is local state while focused so a half-typed `1:` is not
 * reinterpreted on every keystroke; it commits on blur and on Enter.
 */
export function DurationField({
  seconds,
  onChange,
  className,
}: DurationFieldProps) {
  const t = useT();
  const [draft, setDraft] = React.useState<string | null>(null);

  const commit = (text: string) => {
    const parsed = parseDuration(text);
    setDraft(null);
    // Unparseable input reverts rather than snapping to zero, which would
    // silently destroy the step the moment someone fat-fingers a character.
    if (parsed != null) onChange(Math.max(MIN_STEP_SECONDS, parsed));
  };

  const nudge = (delta: number) => {
    setDraft(null);
    onChange(Math.max(MIN_STEP_SECONDS, seconds + delta));
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        aria-label={t("workouts.step.durationStep", {
          step: `-${STEP_SECONDS}`,
        })}
        onClick={() => nudge(-STEP_SECONDS)}
        className="border-input text-muted-foreground hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors"
      >
        <MinusIcon className="size-3" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={t("workouts.step.duration")}
        placeholder={t("workouts.step.durationHint")}
        value={draft ?? formatDurationInput(seconds)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
          }
          if (event.key === "Escape") setDraft(null);
        }}
        className="border-input bg-background focus-visible:ring-ring h-7 w-16 rounded-md border px-2 text-center font-mono text-sm tabular-nums outline-none focus-visible:ring-1"
      />
      <button
        type="button"
        aria-label={t("workouts.step.durationStep", {
          step: `+${STEP_SECONDS}`,
        })}
        onClick={() => nudge(STEP_SECONDS)}
        className="border-input text-muted-foreground hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors"
      >
        <PlusIcon className="size-3" />
      </button>
    </div>
  );
}
