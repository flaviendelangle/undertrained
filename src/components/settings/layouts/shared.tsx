import * as React from "react";

import { CardTitle } from "~/components/primitives/CardTitle";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Label } from "~/components/ui/label";
import { NumberField } from "~/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { AppMessageKey, TFunction } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
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
  const t = useT();
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
          tooltip={t("settings.equipment.tooltip")}
          description={t("settings.equipment.description")}
        >
          {t("settings.equipment.title")}
        </CardTitle>
      )}
      <div className={className ?? "grid grid-cols-1 gap-5 sm:grid-cols-3"}>
        <div className="flex flex-col gap-2">
          <Label>{t("settings.equipment.bikeWeight")}</Label>
          <NumberField
            value={timeline.bikeWeightKg}
            onValueChange={(v) => updateStatic("bikeWeightKg", v)}
            min={0}
            step={0.5}
            smallStep={0.1}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t("settings.equipment.cda")}</Label>
          <NumberField
            value={timeline.cdA}
            onValueChange={(v) => updateStatic("cdA", v)}
            min={0}
            step={0.01}
            smallStep={0.001}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t("settings.equipment.crr")}</Label>
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
  options: readonly { value: string; labelKey: AppMessageKey }[],
  t: TFunction,
): (value: string | null) => string {
  return (value) => {
    const option = options.find((o) => o.value === value);
    return option ? t(option.labelKey) : (value ?? "");
  };
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
  const t = useT();
  return (
    <div
      className={
        className ??
        `grid grid-cols-1 gap-5 sm:grid-cols-${LOAD_ALGORITHM_CONFIGS.length}`
      }
    >
      {LOAD_ALGORITHM_CONFIGS.map((config) => {
        const currentValue = (timeline as unknown as Record<string, string>)[
          config.key
        ];
        return (
          <div key={config.key} className="flex flex-col gap-2">
            <Label>{t(config.labelKey)}</Label>
            <Select
              value={currentValue}
              onValueChange={(v) =>
                setTimeline({ ...timeline, [config.key]: v })
              }
            >
              <SelectTrigger>
                <SelectValue>{renderLabel(config.options, t)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {config.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
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
  const t = useT();
  const content = (
    <>
      <h2
        className={`text-destructive font-semibold ${variant === "card" ? "mb-2 text-lg" : "mb-1 text-base"}`}
      >
        {t("settings.dangerZone.title")}
      </h2>
      <p className="text-muted-foreground mb-4 text-sm">
        {t("settings.dangerZone.description")}
      </p>
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        trigger={
          <Button variant="destructive" disabled={deleting}>
            {t("settings.dangerZone.deleteAll")}
          </Button>
        }
        title={t("settings.dangerZone.dialogTitle")}
        description={t("settings.dangerZone.dialogDescription")}
        confirmLabel={t("settings.dangerZone.confirm")}
        pendingLabel={t("settings.dangerZone.deleting")}
        onConfirm={onDeleteAllData}
      />
    </>
  );

  if (variant === "inline") {
    return content;
  }

  return (
    <section className="md:border-destructive/30 md:bg-card p-5 md:rounded-sm md:border">
      {content}
    </section>
  );
}
