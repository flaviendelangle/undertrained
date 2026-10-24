import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { getSportConfig } from "~/utils/sportConfig";

/** A pressable filter chip, laid out in a grid by its `ToggleGroup`. */
export const CHIP_TOGGLE_CLASS =
  "border-border text-muted-foreground hover:bg-accent hover:text-foreground data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:border-primary inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors";

/** A multi-select grid of sport-type chips (icon + label). */
export function SportTypeToggleGroup({
  types,
  value,
  onValueChange,
  className,
  "aria-label": ariaLabel,
}: {
  types: readonly string[];
  value: string[];
  onValueChange: (value: string[]) => void;
  /** Grid columns. */
  className?: string;
  "aria-label": string;
}) {
  const t = useT();
  return (
    <ToggleGroup
      multiple
      aria-label={ariaLabel}
      value={value}
      onValueChange={onValueChange}
      className={cn("grid gap-1.5", className)}
    >
      {types.map((type) => {
        const Icon = getSportConfig(type).icon;
        return (
          <Toggle key={type} value={type} className={CHIP_TOGGLE_CLASS}>
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{sportTypeLabel(type, t)}</span>
          </Toggle>
        );
      })}
    </ToggleGroup>
  );
}
