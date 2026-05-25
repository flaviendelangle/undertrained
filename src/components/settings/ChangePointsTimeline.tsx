import { useMemo, useState } from "react";

import { BarChart3Icon, PlusIcon } from "lucide-react";

import { CardTitle } from "~/components/primitives/CardTitle";
import { Button } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { cn } from "~/lib/utils";
import type {
  RiderSettingsChangePoint,
  RiderSettingsTimeline,
  TimeVaryingField,
} from "~/sensors/types";

import { ChangePointDialog } from "./ChangePointDialog";
import { SettingsStepChart } from "./SettingsStepChart";
import { RIDER_FIELD_CONFIG, TIME_VARYING_FIELDS, formatPace } from "./fieldConfig";

interface ResolvedRow {
  id: string;
  label: string;
  values: Record<TimeVaryingField, number | null>;
  changed: Set<TimeVaryingField>;
  isBaseline: boolean;
}

function buildResolvedRows(timeline: RiderSettingsTimeline): ResolvedRow[] {
  const rows: ResolvedRow[] = [];
  const current = { ...timeline.initialValues };

  rows.push({
    id: "baseline",
    label: "Baseline",
    values: { ...current },
    changed: new Set(TIME_VARYING_FIELDS),
    isBaseline: true,
  });

  for (const change of timeline.changes) {
    const changedFields = new Set<TimeVaryingField>();
    for (const field of TIME_VARYING_FIELDS) {
      if (change[field] !== undefined) {
        current[field] = change[field]!;
        changedFields.add(field);
      }
    }
    rows.push({
      id: change.id,
      label: change.date,
      values: { ...current },
      changed: changedFields,
      isBaseline: false,
    });
  }

  return rows;
}

function formatFieldValue(
  field: (typeof RIDER_FIELD_CONFIG)[number],
  value: number | null,
): string {
  if (value == null) return "—";
  if (field.inputType === "pace" && field.paceUnit) {
    return formatPace(value, field.paceUnit);
  }
  return `${value}${field.unit}`;
}

interface ChangePointsTimelineProps {
  timeline: RiderSettingsTimeline;
  onTimelineChange: (timeline: RiderSettingsTimeline) => void;
  hasSettings?: boolean;
}

export function ChangePointsTimeline({
  timeline,
  onTimelineChange,
  hasSettings = true,
}: ChangePointsTimelineProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<
    RiderSettingsChangePoint | undefined
  >();
  const [editingBaseline, setEditingBaseline] = useState(false);
  const [timelineDialogOpen, setTimelineDialogOpen] = useState(false);

  const resolvedRows = useMemo(() => buildResolvedRows(timeline), [timeline]);

  const handleAdd = () => {
    setEditingBaseline(false);
    setEditingPoint(undefined);
    setDialogOpen(true);
  };

  const handleEditBaseline = () => {
    setEditingBaseline(true);
    setEditingPoint(undefined);
    setDialogOpen(true);
  };

  const handleEditChange = (point: RiderSettingsChangePoint) => {
    setEditingBaseline(false);
    setEditingPoint(point);
    setDialogOpen(true);
  };

  const handleSave = (point: RiderSettingsChangePoint) => {
    const existingIndex = timeline.changes.findIndex((c) => c.id === point.id);
    let newChanges: RiderSettingsChangePoint[];
    if (existingIndex >= 0) {
      newChanges = [...timeline.changes];
      newChanges[existingIndex] = point;
    } else {
      const sameDateIndex = timeline.changes.findIndex(
        (c) => c.date === point.date,
      );
      if (sameDateIndex >= 0) {
        const merged = { ...timeline.changes[sameDateIndex] };
        for (const field of TIME_VARYING_FIELDS) {
          if (point[field] !== undefined) {
            merged[field] = point[field];
          }
        }
        newChanges = [...timeline.changes];
        newChanges[sameDateIndex] = merged;
      } else {
        newChanges = [...timeline.changes, point];
      }
    }
    onTimelineChange({ ...timeline, changes: newChanges });
  };

  const handleSaveBaseline = (values: Record<TimeVaryingField, number | null>) => {
    onTimelineChange({ ...timeline, initialValues: values });
  };

  const handleDelete = (id: string) => {
    onTimelineChange({
      ...timeline,
      changes: timeline.changes.filter((c) => c.id !== id),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <CardTitle
        tooltip="Set your baseline fitness values and track how they change over time. These are used to calculate training load and power metrics for your activities. Add a change point when you do an FTP test or your weight changes — past activities will use the settings that were active on their date."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTimelineDialogOpen(true)}
            >
              <BarChart3Icon className="mr-1.5 size-3.5" />
              Timeline
            </Button>
            <Button size="sm" onClick={handleAdd}>
              <PlusIcon className="mr-1.5 size-3.5" />
              Add Change
            </Button>
          </div>
        }
      >
        Rider Settings
      </CardTitle>

      <div className="flex flex-col gap-2">
        {resolvedRows.map((row) => {
          const isDefaultBaseline = row.isBaseline && !hasSettings;
          return (
            <div
              key={row.id}
              className={cn(
                "rounded-lg border px-4 py-3",
                isDefaultBaseline
                  ? "border-border border-dashed"
                  : "border-border bg-card border",
              )}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-sm font-medium",
                      row.isBaseline
                        ? "text-foreground"
                        : "text-muted-foreground font-mono",
                    )}
                  >
                    {row.label}
                  </span>
                </div>
                <Button
                  variant={isDefaultBaseline ? "default" : "ghost"}
                  size="xs"
                  onClick={() => {
                    if (row.isBaseline) {
                      handleEditBaseline();
                    } else {
                      const point = timeline.changes.find(
                        (c) => c.id === row.id,
                      );
                      if (point) handleEditChange(point);
                    }
                  }}
                >
                  {isDefaultBaseline ? "Set your values" : "Edit"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {RIDER_FIELD_CONFIG.map((config) => {
                  const isChanged = row.changed.has(config.field);
                  if (!row.isBaseline && !isChanged) return null;
                  const isNull = row.values[config.field] == null;
                  return (
                    <span
                      key={config.field}
                      className={cn(
                        "rounded-md px-2 py-0.5 text-xs",
                        isDefaultBaseline || isNull
                          ? "bg-muted text-muted-foreground"
                          : isChanged
                            ? "bg-primary/10 text-primary font-medium"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {config.label}: {formatFieldValue(config, row.values[config.field])}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <ResponsiveDialog
        open={timelineDialogOpen}
        onOpenChange={setTimelineDialogOpen}
      >
        <ResponsiveDialogContent className="sm:max-w-3xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Settings Timeline</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <SettingsStepChart timeline={timeline} />
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ChangePointDialog
        key={editingBaseline ? "baseline" : (editingPoint?.id ?? "new")}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={editingBaseline ? "baseline" : "change"}
        existingPoint={editingPoint}
        baselineValues={editingBaseline ? timeline.initialValues : undefined}
        isDefaults={editingBaseline && !hasSettings}
        onSave={handleSave}
        onSaveBaseline={handleSaveBaseline}
        onDelete={
          editingPoint ? () => handleDelete(editingPoint.id) : undefined
        }
      />
    </div>
  );
}
