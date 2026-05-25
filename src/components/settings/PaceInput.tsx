import { NumberField } from "~/components/ui/number-field";

import { paceToSpeed, speedToPace } from "./fieldConfig";

/**
 * Two-field minute:second pace editor. Stores/returns speed in m/s; the
 * `paceUnit` controls the distance basis ("/km" or "/100m").
 *
 * Extracted from the original `ChangePointDialog` so cards, the grid, and the
 * timeline popover can all reuse it.
 */
export function PaceInput({
  value,
  paceUnit,
  placeholderMinutes,
  placeholderSeconds,
  className,
  inputClassName,
  onChange,
}: {
  value: number | null;
  paceUnit: "/km" | "/100m";
  placeholderMinutes?: string;
  placeholderSeconds?: string;
  className?: string;
  inputClassName?: string;
  onChange: (speed: number | null) => void;
}) {
  const pace = value != null ? speedToPace(value, paceUnit) : null;

  const handleMinutesChange = (m: number | null) => {
    if (m == null) {
      onChange(null);
      return;
    }
    onChange(paceToSpeed(m, pace?.seconds ?? 0, paceUnit));
  };

  const handleSecondsChange = (s: number | null) => {
    if (s == null) {
      onChange(null);
      return;
    }
    onChange(paceToSpeed(pace?.minutes ?? 0, s, paceUnit));
  };

  return (
    <div className={className ?? "flex items-center gap-2"}>
      <NumberField
        className={inputClassName ?? "w-20"}
        value={pace?.minutes ?? null}
        onValueChange={handleMinutesChange}
        min={0}
        step={1}
        placeholder={placeholderMinutes}
      />
      <span className="text-muted-foreground">:</span>
      <NumberField
        className={inputClassName ?? "w-20"}
        value={pace?.seconds ?? null}
        onValueChange={handleSecondsChange}
        min={0}
        max={59}
        step={1}
        placeholder={placeholderSeconds ?? (value == null ? "00" : undefined)}
      />
      <span className="text-muted-foreground text-sm whitespace-nowrap">
        {paceUnit}
      </span>
    </div>
  );
}
