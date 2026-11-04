import * as React from "react";
import type { ReactNode } from "react";

import { CardTitle } from "~/components/primitives/CardTitle";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Field, FieldLabel } from "~/components/ui/field";
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
import { cn } from "~/lib/utils";
import type { RiderSettingsTimeline } from "~/sensors/types";
import { getLoadAlgorithmConfigs } from "~/utils/sportConfig";

/**
 * One setting: its label on the left, its control on the right, ruled off from
 * the row above like the rows of the profile table. On phones the control goes
 * under its label, full width.
 */
export function SettingRow({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Field
      className={cn(
        "border-border/60 min-h-12 gap-2 border-t py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-2",
        className,
      )}
    >
      <FieldLabel className="min-w-0">{label}</FieldLabel>
      {children}
    </Field>
  );
}

/**
 * A titled group of setting rows. Side by side panels share their parent's row
 * tracks (`subgrid`), so their rows line up even when one description wraps
 * onto more lines than the other.
 */
export function SettingsPanel({
  title,
  tooltip,
  description,
  rows,
  children,
  className,
}: {
  title: string;
  tooltip?: string;
  description?: string;
  /** How many rows the panel spans in its parent grid, its title included. */
  rows: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      style={{ gridRow: `span ${rows}` }}
      className={cn("flex flex-col lg:grid lg:grid-rows-subgrid", className)}
    >
      <CardTitle tooltip={tooltip} description={description}>
        {title}
      </CardTitle>
      {children}
    </section>
  );
}

const EQUIPMENT_FIELDS = [
  {
    field: "bikeWeightKg",
    labelKey: "settings.equipment.bikeWeight",
    step: 0.5,
    smallStep: 0.1,
  },
  {
    field: "cdA",
    labelKey: "settings.equipment.cda",
    step: 0.01,
    smallStep: 0.001,
  },
  {
    field: "crr",
    labelKey: "settings.equipment.crr",
    step: 0.001,
    smallStep: 0.0001,
  },
] as const satisfies readonly {
  field: "cdA" | "crr" | "bikeWeightKg";
  labelKey: AppMessageKey;
  step: number;
  smallStep: number;
}[];

/** Rows the equipment and load algorithm panels span: title + 3 settings. */
export const EQUIPMENT_PANEL_ROWS = EQUIPMENT_FIELDS.length + 1;

export function EquipmentFields({
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
    <SettingsPanel
      title={t("settings.equipment.title")}
      tooltip={t("settings.equipment.tooltip")}
      description={t("settings.equipment.description")}
      rows={EQUIPMENT_PANEL_ROWS}
      className={className}
    >
      {EQUIPMENT_FIELDS.map(({ field, labelKey, step, smallStep }) => (
        <SettingRow key={field} label={t(labelKey)}>
          <NumberField
            value={timeline[field]}
            onValueChange={(v) => setTimeline({ ...timeline, [field]: v ?? 0 })}
            min={0}
            step={step}
            smallStep={smallStep}
            className="w-full shrink-0 sm:w-32"
          />
        </SettingRow>
      ))}
    </SettingsPanel>
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
    <SettingsPanel
      title={t("settings.loadAlgorithm.title")}
      tooltip={t("settings.loadAlgorithm.tooltip")}
      description={t("settings.loadAlgorithm.description")}
      rows={LOAD_ALGORITHM_CONFIGS.length + 1}
      className={className}
    >
      {LOAD_ALGORITHM_CONFIGS.map((config) => (
        <SettingRow key={config.key} label={t(config.labelKey)}>
          <Select
            value={timeline[config.key]}
            onValueChange={(v) => setTimeline({ ...timeline, [config.key]: v })}
          >
            <SelectTrigger size="sm" className="w-full shrink-0 sm:w-60">
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
        </SettingRow>
      ))}
    </SettingsPanel>
  );
}

export function DangerZone({
  onDeleteAllData,
  deleting,
  deleteDialogOpen,
  setDeleteDialogOpen,
}: {
  onDeleteAllData: () => Promise<void>;
  deleting: boolean;
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <section className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:py-0">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">
          {t("settings.dangerZone.title")}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.dangerZone.description")}
        </p>
      </div>
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        trigger={
          <Button
            variant="destructive"
            disabled={deleting}
            className="shrink-0 self-start md:self-auto"
          >
            {t("settings.dangerZone.deleteAll")}
          </Button>
        }
        title={t("settings.dangerZone.dialogTitle")}
        description={t("settings.dangerZone.dialogDescription")}
        confirmLabel={t("settings.dangerZone.confirm")}
        pendingLabel={t("settings.dangerZone.deleting")}
        onConfirm={onDeleteAllData}
      />
    </section>
  );
}
