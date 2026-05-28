import * as React from "react";

import { PlusIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useAthleteId } from "~/hooks/useAthleteId";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
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
  });

  const updateMutation = trpc.timePeriods.update.useMutation({
    onSuccess: () => {
      // Fire-and-forget: refresh the lists without blocking the form close.
      void utils.timePeriods.invalidate();
      void utils.activities.list.invalidate();
      onSuccess?.();
    },
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

  const toggleSportType = (type: string) => {
    setForm((prev) => ({
      ...prev,
      sportTypes: prev.sportTypes.includes(type)
        ? prev.sportTypes.filter((t) => t !== type)
        : [...prev.sportTypes, type],
    }));
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>{t("periods.name")}</Label>
        <input
          type="text"
          value={form.name}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, name: e.target.value }))
          }
          placeholder={t("periods.namePlaceholder")}
          className="border-border bg-background h-9 rounded-md border px-3 text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label>{t("periods.startDate")}</Label>
          <input
            type="date"
            value={form.startDate}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, startDate: e.target.value }))
            }
            className="border-border bg-background h-9 rounded-md border px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t("periods.endDate")}</Label>
          <input
            type="date"
            value={form.endDate}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, endDate: e.target.value }))
            }
            className="border-border bg-background h-9 rounded-md border px-3 text-sm"
          />
        </div>
      </div>
      {activityTypes && activityTypes.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>
            {t("periods.sportTypes")}{" "}
            <span className="text-muted-foreground font-normal">
              {t("periods.sportTypesHint")}
            </span>
          </Label>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {activityTypes.map((type) => {
              const Icon = getSportConfig(type).icon;
              const active = form.sportTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleSportType(type)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{sportTypeLabel(type, t)}</span>
                </button>
              );
            })}
          </div>
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
