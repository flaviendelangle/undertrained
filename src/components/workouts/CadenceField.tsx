import * as React from "react";

import { XIcon } from "lucide-react";

import { useT } from "~/i18n/useT";
import type { CadenceTarget } from "~/utils/structuredWorkout";

/** Offered when cadence is first added — a normal seated cadence. */
const DEFAULT_CADENCE = 90;

const MIN_RPM = 30;
const MAX_RPM = 200;

interface CadenceFieldProps {
  value: CadenceTarget | undefined;
  onChange: (cadence: CadenceTarget | undefined) => void;
}

/**
 * Cadence is optional and usually absent, so it stays collapsed behind a chip
 * until asked for rather than taking a slot on every row.
 *
 * A single number, like power: the band outside which the rider is warned is a
 * property of riding the step, not of the plan (see `cadenceTolerance`).
 */
export function CadenceField({ value, onChange }: CadenceFieldProps) {
  const t = useT();
  const [draft, setDraft] = React.useState<string | null>(null);

  if (value == null) {
    return (
      <button
        type="button"
        onClick={() => onChange(DEFAULT_CADENCE)}
        className="border-input text-muted-foreground hover:text-foreground h-7 shrink-0 rounded-md border border-dashed px-2 text-xs transition-colors"
      >
        + {t("workouts.step.addCadence")}
      </button>
    );
  }

  const commit = (text: string) => {
    setDraft(null);
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return;
    onChange(Math.min(MAX_RPM, Math.max(MIN_RPM, Math.round(parsed))));
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        inputMode="numeric"
        aria-label={t("workouts.step.cadence")}
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
          }
          if (event.key === "Escape") setDraft(null);
        }}
        className="border-input bg-background focus-visible:ring-ring h-7 w-12 rounded-md border px-1 text-center font-mono text-sm tabular-nums outline-none focus-visible:ring-1"
      />
      <span className="text-muted-foreground text-xs">rpm</span>
      <button
        type="button"
        aria-label={t("workouts.step.removeCadence")}
        onClick={() => onChange(undefined)}
        className="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}
