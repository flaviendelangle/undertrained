import * as React from "react";

import { PlusIcon } from "lucide-react";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

import { Button } from "~/components/ui/button";
import {
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
} from "~/components/ui/field";
import { Label } from "~/components/ui/label";
import { showErrorToast } from "~/components/ui/toast";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useAthleteId } from "~/hooks/useAthleteId";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { getSportConfig } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

interface TimePeriodFormData {
  name: string;
  startDate: string;
  endDate: string;
  sportTypes: string[];
}

interface TimePeriodFormProps {
  period?: {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
    sportTypes: string[] | null;
  };
  onSuccess?: () => void;
}

export function TimePeriodForm({ period, onSuccess }: TimePeriodFormProps) {
  const t = useT();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();
  const { allTypes: activityTypes } = useActivitiesQuery();

  const [form, setForm] = React.useState<TimePeriodFormData>(() => ({
    name: period?.name ?? "",
    startDate: period?.startDate ?? "",
    endDate: period?.endDate ?? "",
    sportTypes: period?.sportTypes ?? [],
  }));

  // Re-sync the form when editing a different period (during render rather than
  // in an effect, to avoid an extra render pass).
  const [prevPeriod, setPrevPeriod] = React.useState(period);
  if (period !== prevPeriod) {
    setPrevPeriod(period);
    if (period) {
      setForm({
        name: period.name,
        startDate: period.startDate,
        endDate: period.endDate,
        sportTypes: period.sportTypes ?? [],
      });
    }
  }

  const createMutation = trpc.timePeriods.create.useMutation({
    onSuccess: () => {
      // Fire-and-forget: refresh the lists without blocking the form reset/close.
      void utils.timePeriods.invalidate();
      setForm({ name: "", startDate: "", endDate: "", sportTypes: [] });
      onSuccess?.();
    },
    onError: () => showErrorToast(t("common.saveError")),
  });

  const updateMutation = trpc.timePeriods.update.useMutation({
    onSuccess: () => {
      // Fire-and-forget: refresh the lists without blocking the form close.
      void utils.timePeriods.invalidate();
      void utils.activities.list.invalidate();
      onSuccess?.();
    },
    onError: () => showErrorToast(t("common.saveError")),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!athleteId || !form.name || !form.startDate || !form.endDate) return;
    const payload = {
      athleteId,
      name: form.name,
      startDate: form.startDate,
      endDate: form.endDate,
      sportTypes: form.sportTypes.length > 0 ? form.sportTypes : null,
    };
    if (period) {
      updateMutation.mutate({ ...payload, id: period.id });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field name="name">
        <FieldLabel>{t("periods.name")}</FieldLabel>
        <FieldControl
          required
          value={form.name}
          onValueChange={(name) => setForm((prev) => ({ ...prev, name }))}
          placeholder={t("periods.namePlaceholder")}
        />
        <FieldError />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field name="startDate">
          <FieldLabel>{t("periods.startDate")}</FieldLabel>
          <FieldControl
            required
            type="date"
            value={form.startDate}
            onValueChange={(startDate) =>
              setForm((prev) => ({ ...prev, startDate }))
            }
          />
          <FieldError />
        </Field>
        <Field name="endDate">
          <FieldLabel>{t("periods.endDate")}</FieldLabel>
          <FieldControl
            required
            type="date"
            value={form.endDate}
            onValueChange={(endDate) =>
              setForm((prev) => ({ ...prev, endDate }))
            }
          />
          <FieldError />
        </Field>
      </div>
      {activityTypes && activityTypes.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>
            {t("periods.sportTypes")}{" "}
            <span className="text-muted-foreground font-normal">
              {t("periods.sportTypesHint")}
            </span>
          </Label>
          <ToggleGroup
            multiple
            aria-label={t("periods.sportTypes")}
            value={form.sportTypes}
            onValueChange={(sportTypes) =>
              setForm((prev) => ({ ...prev, sportTypes }))
            }
            className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"
          >
            {activityTypes.map((type) => {
              const Icon = getSportConfig(type).icon;
              return (
                <Toggle
                  key={type}
                  value={type}
                  className="border-border text-muted-foreground hover:bg-accent hover:text-foreground data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:border-primary inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors"
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{sportTypeLabel(type, t)}</span>
                </Toggle>
              );
            })}
          </ToggleGroup>
        </div>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={
            isSubmitting || !form.name || !form.startDate || !form.endDate
          }
        >
          {period ? (
            isSubmitting ? (
              t("periods.saving")
            ) : (
              t("periods.update")
            )
          ) : (
            <>
              <PlusIcon className="size-4" />
              {isSubmitting ? t("periods.creating") : t("periods.createPeriod")}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
