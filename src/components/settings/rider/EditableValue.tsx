import { useEffect, useRef, useState } from "react";

import { NumberField } from "~/components/ui/number-field";
import { cn } from "~/lib/utils";

import { PaceInput } from "../PaceInput";
import { type RiderFieldConfig, formatFieldValue } from "../fieldConfig";

interface EditableValueProps {
  config: RiderFieldConfig;
  value: number | null;
  /** Ghost value shown (muted) when `value` is null — e.g. an inherited/default value. */
  placeholderValue?: number | null;
  /** Text shown when value is null and no placeholder is given. */
  emptyLabel?: string;
  onCommit: (value: number | null) => void;
  /** Classes for the read-mode trigger. */
  displayClassName?: string;
  /** Classes for the NumberField group in edit mode. */
  inputClassName?: string;
}

/**
 * Click-to-edit value. Shows formatted text; clicking swaps in a `NumberField`
 * (or `PaceInput` for pace fields). Commits on blur or Enter, cancels on Escape.
 * Holds a local draft so editing never fires a save per keystroke.
 */
export function EditableValue({
  config,
  value,
  placeholderValue,
  emptyLabel = "—",
  onCommit,
  displayClassName,
  inputClassName = "w-24",
}: EditableValueProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | null>(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the draft in sync when not actively editing.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Focus the first input when entering edit mode.
  useEffect(() => {
    if (!editing) return;
    const input = containerRef.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    const isEmpty = value == null;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "rounded px-1 text-left hover:bg-muted/60 focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none",
          isEmpty && "text-muted-foreground",
          displayClassName,
        )}
      >
        {isEmpty
          ? placeholderValue != null
            ? formatFieldValue(config, placeholderValue)
            : emptyLabel
          : formatFieldValue(config, value)}
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
    >
      {config.inputType === "pace" && config.paceUnit ? (
        <PaceInput
          value={draft}
          paceUnit={config.paceUnit}
          inputClassName="w-14"
          onChange={setDraft}
        />
      ) : (
        <NumberField
          value={draft}
          onValueChange={setDraft}
          min={config.min}
          step={config.step}
          smallStep={config.smallStep}
          className={inputClassName}
        />
      )}
    </div>
  );
}
