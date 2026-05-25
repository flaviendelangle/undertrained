import { useState } from "react";

import { format } from "date-fns";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { Label } from "~/components/ui/label";
import { NumberField } from "~/components/ui/number-field";
import {
  DEFAULT_RIDER_SETTINGS_TIMELINE,
  type RiderSettingsChangePoint,
  type TimeVaryingField,
} from "~/sensors/types";

import {
  RIDER_FIELD_CONFIG,
  type RiderFieldConfig,
  formatPace,
  paceToSpeed,
  speedToPace,
} from "./fieldConfig";

const DEFAULTS = DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues;

function PaceInput({
  value,
  paceUnit,
  placeholderMinutes,
  placeholderSeconds,
  onChange,
}: {
  value: number | null;
  paceUnit: "/km" | "/100m";
  placeholderMinutes?: string;
  placeholderSeconds?: string;
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
    <div className="flex items-center gap-2">
      <NumberField
        className="w-20"
        value={pace?.minutes ?? null}
        onValueChange={handleMinutesChange}
        min={0}
        step={1}
        placeholder={placeholderMinutes}
      />
      <span className="text-muted-foreground">:</span>
      <NumberField
        className="w-20"
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

type NullableValues = Record<TimeVaryingField, number | null>;

interface ChangePointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "baseline" | "change";
  existingPoint?: RiderSettingsChangePoint;
  baselineValues?: Record<TimeVaryingField, number | null>;
  isDefaults?: boolean;
  onSave: (point: RiderSettingsChangePoint) => void;
  onSaveBaseline: (values: Record<TimeVaryingField, number | null>) => void;
  onDelete?: () => void;
}

export function ChangePointDialog({
  open,
  onOpenChange,
  mode,
  existingPoint,
  baselineValues,
  isDefaults,
  onSave,
  onSaveBaseline,
  onDelete,
}: ChangePointDialogProps) {
  const isBaseline = mode === "baseline";

  const [date, setDate] = useState(
    existingPoint?.date ?? format(new Date(), "yyyy-MM-dd"),
  );
  const [enabledFields, setEnabledFields] = useState<Set<TimeVaryingField>>(
    () => {
      if (!existingPoint) return new Set();
      const fields = new Set<TimeVaryingField>();
      for (const { field } of RIDER_FIELD_CONFIG) {
        if (existingPoint[field] !== undefined) fields.add(field);
      }
      return fields;
    },
  );
  const [values, setValues] = useState<NullableValues>(() => {
    if (isBaseline && isDefaults) {
      // Show empty fields with placeholders when editing defaults
      return {
        ftp: null,
        weightKg: null,
        restingHr: null,
        maxHr: null,
        lthr: null,
        runThresholdPace: null,
        swimThresholdPace: null,
      };
    }
    if (baselineValues) return { ...baselineValues };
    const result: NullableValues = {} as NullableValues;
    for (const { field } of RIDER_FIELD_CONFIG) {
      result[field] = existingPoint?.[field] ?? DEFAULTS[field];
    }
    return result;
  });

  const handleSave = () => {
    if (isBaseline) {
      onSaveBaseline({ ...values });
      onOpenChange(false);
      return;
    }

    const point: RiderSettingsChangePoint = {
      id: existingPoint?.id ?? crypto.randomUUID(),
      date,
    };
    for (const { field } of RIDER_FIELD_CONFIG) {
      if (enabledFields.has(field)) {
        point[field] = values[field] ?? DEFAULTS[field] ?? undefined;
      }
    }
    onSave(point);
    onOpenChange(false);
  };

  const toggleField = (field: TimeVaryingField) => {
    setEnabledFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  };

  const getPlaceholder = (config: RiderFieldConfig): string | undefined => {
    if (!isBaseline) return undefined;
    const defaultVal = DEFAULTS[config.field]!;
    if (config.inputType === "pace" && config.paceUnit) {
      return formatPace(defaultVal, config.paceUnit);
    }
    return `${defaultVal}`;
  };

  const renderFieldInput = (config: RiderFieldConfig) => {
    const placeholder = getPlaceholder(config);

    if (config.inputType === "pace" && config.paceUnit) {
      const placeholderPace = DEFAULTS[config.field]!;
      const { minutes: pMin, seconds: pSec } = speedToPace(placeholderPace, config.paceUnit);
      return (
        <PaceInput
          value={values[config.field]}
          paceUnit={config.paceUnit}
          placeholderMinutes={isBaseline ? `${pMin}` : undefined}
          placeholderSeconds={isBaseline ? String(pSec).padStart(2, "0") : undefined}
          onChange={(speed) =>
            setValues((prev) => ({ ...prev, [config.field]: speed }))
          }
        />
      );
    }

    return (
      <NumberField
        value={values[config.field]}
        onValueChange={(value) =>
          setValues((prev) => ({ ...prev, [config.field]: value }))
        }
        min={config.min}
        step={config.step}
        smallStep={config.smallStep}
        placeholder={placeholder}
      />
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {isBaseline
              ? "Edit Baseline Values"
              : existingPoint
                ? "Edit Change Point"
                : "Add Change Point"}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <div className="flex flex-col gap-4">
            {!isBaseline && (
              <div className="flex flex-col gap-1.5">
                <Label>Date</Label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
                />
              </div>
            )}
            {RIDER_FIELD_CONFIG.map((config) => (
              <div key={config.field} className="flex flex-col gap-1.5">
                {isBaseline ? (
                  <Label>
                    {config.label}{" "}
                    ({config.inputType === "pace" ? `min:sec ${config.paceUnit}` : config.unit})
                  </Label>
                ) : (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={enabledFields.has(config.field)}
                      onCheckedChange={() => toggleField(config.field)}
                    />
                    <Label>
                      {config.label}{" "}
                      ({config.inputType === "pace" ? `min:sec ${config.paceUnit}` : config.unit})
                    </Label>
                  </div>
                )}
                {(isBaseline || enabledFields.has(config.field)) &&
                  renderFieldInput(config)}
              </div>
            ))}
          </div>
          <ResponsiveDialogFooter>
            {!isBaseline && existingPoint && onDelete && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  onDelete();
                  onOpenChange(false);
                }}
                className="sm:mr-auto"
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isBaseline && enabledFields.size === 0}
            >
              Save
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
