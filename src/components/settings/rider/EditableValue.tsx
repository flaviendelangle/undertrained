import { useEffect, useRef, useState } from "react";

import { PencilIcon } from "lucide-react";

import { Quantity } from "~/components/primitives/Quantity";
import { NumberField } from "~/components/ui/number-field";
import { useLocale, useT } from "~/i18n/useT";
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
  /**
   * Which value this is, for its accessible name ("FTP, 2 Sep 2026"); the
   * metric's label by default.
   */
  name?: string;
  onCommit: (value: number | null) => void;
  /** Classes for the read-mode trigger. */
  displayClassName?: string;
  /** Classes for the NumberField group in edit mode. */
  inputClassName?: string;
}

/**
 * Click-to-edit value. Shows formatted text; clicking swaps in a `NumberField`
 * (or `PaceInput` for pace fields). Commits on blur or Enter, cancels on Escape;
 * both keys hand focus back to the value. Holds a local draft so editing never
 * fires a save per keystroke.
 */
export function EditableValue({
  config,
  value,
  placeholderValue,
  emptyLabel = "—",
  name,
  onCommit,
  displayClassName,
  inputClassName = "w-24",
}: EditableValueProps) {
  const t = useT();
  const { locale } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | null>(value);
  const containerRef = useRef<HTMLDivElement>(null);
  // Set when the editor closes from the keyboard, so the value regains focus.
  const restoreFocus = useRef(false);
  const label = name ?? t(config.labelKey);

  // Focus the first input when entering edit mode.
  useEffect(() => {
    if (!editing) return;
    const input = containerRef.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [editing]);

  const startEditing = () => {
    setDraft(value);
    setEditing(true);
  };

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
    const shown = isEmpty ? placeholderValue : value;
    return (
      <button
        type="button"
        ref={(node) => {
          if (node && restoreFocus.current) {
            restoreFocus.current = false;
            node.focus();
          }
        }}
        onClick={startEditing}
        aria-label={t("common.editValue", {
          name:
            shown != null
              ? `${label}, ${formatFieldValue(config, shown)}`
              : label,
        })}
        className={cn(
          "group/edit hover:bg-muted/60 focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded px-1 text-left focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-10",
          isEmpty && "text-muted-foreground",
          displayClassName,
        )}
      >
        <span>
          {shown != null ? (
            <Quantity
              text={formatFieldValue(config, shown)}
              unitClassName="text-[0.8em]"
            />
          ) : (
            emptyLabel
          )}
        </span>
        <PencilIcon
          aria-hidden="true"
          className="text-muted-foreground size-3 shrink-0 transition-opacity group-focus-visible/edit:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/edit:opacity-100"
        />
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          restoreFocus.current = true;
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          restoreFocus.current = true;
          cancel();
        }
      }}
    >
      {config.inputType === "pace" && config.paceUnit ? (
        <PaceInput
          value={draft}
          paceUnit={config.paceUnit}
          label={label}
          onChange={setDraft}
        />
      ) : (
        <NumberField
          value={draft}
          onValueChange={setDraft}
          min={config.min}
          step={config.step}
          smallStep={config.smallStep}
          locale={locale}
          className={inputClassName}
          aria-label={label}
        />
      )}
    </div>
  );
}
