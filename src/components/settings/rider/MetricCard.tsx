import { useState } from "react";

import { format } from "date-fns";
import { PlusIcon, TrendingDownIcon, TrendingUpIcon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { NumberField } from "~/components/ui/number-field";
import { cn } from "~/lib/utils";
import {
  DEFAULT_RIDER_SETTINGS_TIMELINE,
  type RiderSettingsTimeline,
} from "~/sensors/types";

import { PaceInput } from "../PaceInput";
import { type RiderFieldConfig, formatFieldValue } from "../fieldConfig";
import {
  currentFieldValue,
  deleteField,
  getFieldHistory,
  setBaselineField,
  setField,
  startFieldValue,
} from "../timelineEdits";
import { EditableValue } from "./EditableValue";
import { MetricSparkline } from "./MetricSparkline";

const DEFAULTS = DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues;

function formatRowDate(date: string): string {
  return format(new Date(date), "d MMM yyyy");
}

/** Inline "add a new value" row: a date + value, confirmed with a button. */
function AddValueRow({
  config,
  onAdd,
  onCancel,
}: {
  config: RiderFieldConfig;
  onAdd: (date: string, value: number) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [value, setValue] = useState<number | null>(null);

  return (
    <div className="border-primary/40 bg-primary/5 flex flex-wrap items-center gap-2 rounded-md border border-dashed px-2 py-1.5">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="border-input bg-background h-8 rounded-md border px-2 text-sm"
      />
      {config.inputType === "pace" && config.paceUnit ? (
        <PaceInput
          value={value}
          paceUnit={config.paceUnit}
          inputClassName="w-14"
          onChange={setValue}
        />
      ) : (
        <NumberField
          value={value}
          onValueChange={setValue}
          min={config.min}
          step={config.step}
          smallStep={config.smallStep}
          className="w-24"
        />
      )}
      <Button
        size="xs"
        disabled={value == null}
        onClick={() => {
          if (value != null) onAdd(date, value);
        }}
      >
        Add
      </Button>
      <Button size="icon-xs" variant="ghost" onClick={onCancel}>
        <XIcon />
      </Button>
    </div>
  );
}

interface MetricCardProps {
  config: RiderFieldConfig;
  timeline: RiderSettingsTimeline;
  onTimelineChange: (timeline: RiderSettingsTimeline) => void;
  hasSettings: boolean;
}

export function MetricCard({
  config,
  timeline,
  onTimelineChange,
  hasSettings,
}: MetricCardProps) {
  const [adding, setAdding] = useState(false);

  const field = config.field;
  const history = getFieldHistory(timeline, field);
  const changeRows = history.filter((e) => !e.isBaseline).reverse(); // newest first

  const current = hasSettings ? currentFieldValue(timeline, field) : null;
  const start = startFieldValue(timeline, field);
  const hasChanges = changeRows.length > 0;

  // Trend vs. the starting value (speed-based for pace → up = faster = good).
  const trendPct =
    hasSettings && hasChanges && start > 0 && current != null
      ? ((current - start) / start) * 100
      : null;
  const trendUp = trendPct != null && trendPct >= 0;

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      {/* Header: label + current value + trend + sparkline */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{config.label}</div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span
              className={cn(
                "text-2xl font-semibold tabular-nums",
                current == null && "text-muted-foreground",
              )}
            >
              {current != null
                ? formatFieldValue(config, current)
                : formatFieldValue(config, DEFAULTS[field]!)}
            </span>
            {trendPct != null && Math.abs(trendPct) >= 0.5 && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs font-medium",
                  trendUp ? "text-emerald-600" : "text-orange-600",
                )}
              >
                {trendUp ? (
                  <TrendingUpIcon className="size-3" />
                ) : (
                  <TrendingDownIcon className="size-3" />
                )}
                {Math.abs(Math.round(trendPct))}%
              </span>
            )}
          </div>
        </div>
        <MetricSparkline
          timeline={timeline}
          field={field}
          className="w-24 shrink-0"
        />
      </div>

      {/* History rows */}
      <div className="flex flex-col gap-1">
        {changeRows.map((entry) => (
          <div
            key={entry.id}
            className="group flex items-center justify-between gap-2 text-sm"
          >
            <span className="text-muted-foreground font-mono text-xs">
              {formatRowDate(entry.date!)}
            </span>
            <div className="flex items-center gap-1">
              <EditableValue
                config={config}
                value={entry.value}
                onCommit={(v) =>
                  onTimelineChange(setField(timeline, field, entry.date!, v))
                }
                displayClassName="font-medium tabular-nums"
              />
              <Button
                size="icon-xs"
                variant="ghost"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() =>
                  onTimelineChange(deleteField(timeline, field, entry.date!))
                }
              >
                <XIcon />
              </Button>
            </div>
          </div>
        ))}

        {/* Baseline ("Start") row */}
        <div className="flex items-center justify-between gap-2 border-t border-dashed pt-1.5 text-sm">
          <span className="text-muted-foreground text-xs">Start</span>
          <EditableValue
            config={config}
            value={hasSettings ? timeline.initialValues[field] : null}
            placeholderValue={DEFAULTS[field]}
            onCommit={(v) =>
              onTimelineChange(setBaselineField(timeline, field, v))
            }
            displayClassName="font-medium tabular-nums"
          />
        </div>
      </div>

      {/* Add */}
      <div className="mt-2">
        {adding ? (
          <AddValueRow
            config={config}
            onCancel={() => setAdding(false)}
            onAdd={(date, value) => {
              onTimelineChange(setField(timeline, field, date, value));
              setAdding(false);
            }}
          />
        ) : (
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setAdding(true)}
          >
            <PlusIcon className="mr-1 size-3" />
            Log a new {config.label}
          </Button>
        )}
      </div>
    </div>
  );
}
