import * as React from "react";

import { XIcon } from "lucide-react";

import { useT } from "~/i18n/useT";
import type { CadenceTarget } from "~/utils/structuredWorkout";

/** Default band offered when cadence is first added — a normal seated range. */
const DEFAULT_CADENCE: CadenceTarget = { low: 85, high: 95 };

const MIN_RPM = 30;
const MAX_RPM = 200;

function RpmInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (rpm: number) => void;
  label: string;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);

  const commit = (text: string) => {
    setDraft(null);
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return;
    onChange(Math.min(MAX_RPM, Math.max(MIN_RPM, Math.round(parsed))));
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
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
      className="border-input bg-background focus-visible:ring-ring h-7 w-11 rounded-md border px-1 text-center font-mono text-sm tabular-nums outline-none focus-visible:ring-1"
    />
  );
}

interface CadenceFieldProps {
  value: CadenceTarget | undefined;
  onChange: (cadence: CadenceTarget | undefined) => void;
}

/**
 * Cadence is optional and usually absent, so it stays collapsed behind a chip
 * until asked for rather than taking a slot on every row.
 */
export function CadenceField({ value, onChange }: CadenceFieldProps) {
  const t = useT();

  if (!value) {
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

  return (
    <span className="inline-flex items-center gap-1">
      <RpmInput
        value={value.low}
        label={t("workouts.step.cadenceLow")}
        onChange={(low) =>
          onChange({
            low,
            high: value.high == null ? undefined : Math.max(low, value.high),
          })
        }
      />
      <span className="text-muted-foreground text-xs">–</span>
      <RpmInput
        value={value.high ?? value.low}
        label={t("workouts.step.cadenceHigh")}
        onChange={(high) => onChange({ low: Math.min(value.low, high), high })}
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
