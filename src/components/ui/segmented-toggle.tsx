import * as React from "react";

interface SegmentedToggleProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode }[];
  /**
   * `sm` (default) is sized for chart toolbars; `default` matches form inputs
   * (text-sm, h-9-ish padding) so it sits alongside text fields and selects.
   */
  size?: "sm" | "default";
}

export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
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
    size === "default"
      ? "flex-1 rounded px-3 py-1.5"
      : "rounded px-2 py-0.5";
  return (
    <div className={wrapper}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`${button} transition-colors ${
            value === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
