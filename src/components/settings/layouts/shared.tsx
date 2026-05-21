import * as React from "react";

import { CardTitle } from "~/components/primitives/CardTitle";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { NumberField } from "~/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { RiderSettingsTimeline } from "~/sensors/types";
import { getLoadAlgorithmConfigs } from "~/utils/sportConfig";

export interface SettingsLayoutProps {
  timeline: RiderSettingsTimeline;
  setTimeline: (t: RiderSettingsTimeline) => void;
  onDeleteAllData: () => Promise<void>;
  deleting: boolean;
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: (open: boolean) => void;
}

export function EquipmentFields({
  timeline,
  setTimeline,
  className,
  showHeader = true,
}: {
  timeline: RiderSettingsTimeline;
  setTimeline: (t: RiderSettingsTimeline) => void;
  className?: string;
  showHeader?: boolean;
}) {
  const updateStatic = (
    field: "cdA" | "crr" | "bikeWeightKg",
    value: number | null,
  ) => {
    setTimeline({ ...timeline, [field]: value ?? 0 });
  };

  return (
    <div className="flex flex-col gap-5">
      {showHeader && (
        <CardTitle
          tooltip="Only used on the Live Training page to estimate virtual power from speed data. Bike weight affects climbing calculations, CdA (coefficient of drag times frontal area) models air resistance, and Crr (coefficient of rolling resistance) models tire friction."
          description="Used on the Live Training page. These values are constant and do not change over time."
        >
          Equipment & Aerodynamics
        </CardTitle>
      )}
      <div className={className ?? "grid grid-cols-1 gap-5 sm:grid-cols-3"}>
      <div className="flex flex-col gap-2">
        <Label>Bike weight (kg)</Label>
        <NumberField
          value={timeline.bikeWeightKg}
          onValueChange={(v) => updateStatic("bikeWeightKg", v)}
          min={0}
          step={0.5}
          smallStep={0.1}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>CdA (drag coefficient x area)</Label>
        <NumberField
          value={timeline.cdA}
          onValueChange={(v) => updateStatic("cdA", v)}
          min={0}
          step={0.01}
          smallStep={0.001}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Crr (rolling resistance)</Label>
        <NumberField
          value={timeline.crr}
          onValueChange={(v) => updateStatic("crr", v)}
          min={0}
          step={0.001}
          smallStep={0.0001}
        />
      </div>
      </div>
    </div>
  );
}

const LOAD_ALGORITHM_CONFIGS = getLoadAlgorithmConfigs();

function renderLabel(
  options: readonly { value: string; label: string }[],
): (value: string | null) => string {
  return (value) =>
    options.find((o) => o.value === value)?.label ?? value ?? "";
}

export function LoadAlgorithmFields({
  timeline,
  setTimeline,
  className,
}: {
  timeline: RiderSettingsTimeline;
  setTimeline: (t: RiderSettingsTimeline) => void;
  className?: string;
}) {
  return (
    <div
      className={
        className ?? `grid grid-cols-1 gap-5 sm:grid-cols-${LOAD_ALGORITHM_CONFIGS.length}`
      }
    >
      {LOAD_ALGORITHM_CONFIGS.map((config) => {
        const currentValue = (timeline as unknown as Record<string, string>)[config.key];
        return (
          <div key={config.key} className="flex flex-col gap-2">
            <Label>{config.label}</Label>
            <Select
              value={currentValue}
              onValueChange={(v) =>
                setTimeline({ ...timeline, [config.key]: v })
              }
            >
              <SelectTrigger>
                <SelectValue>{renderLabel(config.options)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {config.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}

export function DangerZone({
  onDeleteAllData,
  deleting,
  deleteDialogOpen,
  setDeleteDialogOpen,
  variant = "card",
}: {
  onDeleteAllData: () => Promise<void>;
  deleting: boolean;
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: (open: boolean) => void;
  variant?: "card" | "inline";
}) {
  const content = (
    <>
      <h2
        className={`text-destructive font-semibold ${variant === "card" ? "mb-2 text-lg" : "mb-1 text-base"}`}
      >
        Danger Zone
      </h2>
      <p className="text-muted-foreground mb-4 text-sm">
        Permanently delete all your activities, streams, settings, and log out.
        This cannot be undone.
      </p>
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogTrigger render={<Button variant="destructive" />}>
          Delete all my data
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all data?</DialogTitle>
            <DialogDescription>
              This will permanently delete all your activities, settings, and log
              you out. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={onDeleteAllData}
            >
              {deleting ? "Deleting..." : "Delete everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (variant === "inline") {
    return content;
  }

  return (
    <section className="border-destructive/30 bg-card rounded-sm border max-sm:border-0 p-5">
      {content}
    </section>
  );
}
