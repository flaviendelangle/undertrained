import * as React from "react";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

import { Tooltip } from "~/components/primitives/Tooltip";

interface SegmentedToggleProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: {
    value: T;
    label: React.ReactNode;
    /** Optional hover tooltip — handy when the label is icon-only. */
    tooltip?: string;
  }[];
  /**
   * `sm` (default) is sized for chart toolbars; `default` matches form inputs
   * (text-sm, h-9-ish padding) so it sits alongside text fields and selects.
   */
  size?: "sm" | "default";
  /** Accessible name for the group when there is no nearby visible label. */
  ariaLabel?: string;
}

export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  ariaLabel,
}: SegmentedToggleProps<T>) {
  // `default` is laid out for form fields, where the parent is usually a
  // `flex-col` that stretches its children — so the wrapper fills the row and
  // each option gets an equal share. `sm` keeps the inline, content-sized look
  // used by chart toolbars.
  const wrapper =
    size === "default"
      ? "bg-muted flex w-full rounded-md p-1 text-sm"
      : "bg-muted inline-flex rounded-md p-0.5 text-xs";
  const button =
    size === "default" ? "flex-1 rounded px-3 py-1.5" : "rounded px-2 py-0.5";
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={[value]}
      onValueChange={(nextValue) => {
        // A segmented control must always retain one selected option.
        const selected = nextValue[0];
        if (selected) onChange(selected);
      }}
      className={wrapper}
    >
      {options.map((option) => {
        const control = (
          <Toggle
            value={option.value}
            className={`${button} text-muted-foreground hover:text-foreground data-pressed:bg-background data-pressed:text-foreground transition-colors data-pressed:shadow-sm`}
          >
            {option.label}
          </Toggle>
        );

        if (!option.tooltip) {
          return <React.Fragment key={option.value}>{control}</React.Fragment>;
        }

        return (
          <Tooltip key={option.value} label={option.tooltip} side="bottom">
            {control}
          </Tooltip>
        );
      })}
    </ToggleGroup>
  );
}
