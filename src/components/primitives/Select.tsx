import { Select as SelectPrimitive } from "@base-ui/react/select";

import {
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Select as ShadSelect,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

export function Select<TValue extends string = string>(
  props: SelectProps<TValue>,
) {
  const { options, value, onValueChange, label, className } = props;

  return (
    <ShadSelect
      value={value}
      onValueChange={
        onValueChange
          ? (v) => {
              if (v !== null) onValueChange(v);
            }
          : undefined
      }
    >
      {label && <SelectPrimitive.Label>{label}</SelectPrimitive.Label>}
      <SelectTrigger className={cn("sm:min-w-36", className)}>
        <SelectValue placeholder={options[0]?.label}>
          {(value: string | null) => {
            if (value == null) return options[0]?.label;
            return options.find((o) => o.value === value)?.label ?? value;
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </ShadSelect>
  );
}

export interface SelectProps<TValue extends string = string> {
  value?: TValue;
  onValueChange?: (value: TValue) => void;
  options: { value: TValue; label: string }[];
  /** Visible label, rendered before the trigger; the caller lays the two out. */
  label?: string;
  className?: string;
}
