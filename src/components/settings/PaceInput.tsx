import {
  NumberFieldGroup,
  NumberFieldInput,
  NumberFieldRoot,
} from "~/components/ui/number-field";
import { useT } from "~/i18n/useT";

import { paceToSpeed, speedToPace } from "./fieldConfig";

/**
 * Two-field minute:second pace editor. Stores/returns speed in m/s; the
 * `paceUnit` controls the distance basis ("/km" or "/100m"). The fields drop
 * the stepper buttons (arrow keys still step) so a pace fits where a single
 * number field would.
 */
export function PaceInput({
  value,
  paceUnit,
  label,
  onChange,
}: {
  value: number | null;
  paceUnit: "/km" | "/100m";
  /** What the pace is, to name the minutes and seconds fields. */
  label: string;
  onChange: (speed: number | null) => void;
}) {
  const t = useT();
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
    <div className="flex items-center gap-1">
      <NumberFieldRoot
        value={pace?.minutes ?? null}
        onValueChange={handleMinutesChange}
        min={0}
        step={1}
      >
        <NumberFieldGroup className="w-12">
          <NumberFieldInput
            aria-label={t("settings.metric.paceMinutes", { name: label })}
            className="px-2 text-center"
          />
        </NumberFieldGroup>
      </NumberFieldRoot>
      <span className="text-muted-foreground">:</span>
      <NumberFieldRoot
        value={pace?.seconds ?? null}
        onValueChange={handleSecondsChange}
        min={0}
        max={59}
        step={1}
        format={{ minimumIntegerDigits: 2 }}
      >
        <NumberFieldGroup className="w-12">
          <NumberFieldInput
            aria-label={t("settings.metric.paceSeconds", { name: label })}
            placeholder={value == null ? "00" : undefined}
            className="px-2 text-center"
          />
        </NumberFieldGroup>
      </NumberFieldRoot>
      <span className="text-muted-foreground ml-1 text-sm whitespace-nowrap">
        {paceUnit}
      </span>
    </div>
  );
}
