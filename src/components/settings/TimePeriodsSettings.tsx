import * as React from "react";

import { PencilIcon, PlusIcon, TrashIcon } from "lucide-react";

import { CardTitle } from "~/components/primitives/CardTitle";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useAthleteId } from "~/hooks/useAthleteId";
import { formatActivityType } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";
import { cn } from "~/lib/utils";
import { trpc } from "~/utils/trpc";

export function TimePeriodsSettings() {
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();
  const { data: periods } = trpc.timePeriods.list.useQuery(
    { athleteId: athleteId! },
    { enabled: !!athleteId },
  );
  const deleteMutation = trpc.timePeriods.delete.useMutation({
    onSuccess: () => utils.timePeriods.invalidate(),
  });

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto p-4 sm:p-6 max-sm:px-0">
      <div className="flex w-full max-w-5xl flex-col gap-4 sm:gap-6">
      <section className="border-border bg-card rounded-sm border max-sm:border-0 p-5">
        <CardTitle
          className="mb-4"
          tooltip="Time periods let you define custom date ranges (e.g. a training block or race season) to quickly filter activities and view aggregated statistics for that period."
          actions={
            <TimePeriodDialog>
              <DialogTrigger render={<Button size="sm" />}>
                <PlusIcon className="size-4" />
                Add Period
              </DialogTrigger>
            </TimePeriodDialog>
          }
        >
          Time Periods
        </CardTitle>

        {!periods || periods.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No time periods yet. Create one to quickly filter activities and see
            aggregated statistics.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {periods.map((period) => (
              <div
                key={period.id}
                className="border-border flex items-center justify-between rounded-lg border p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{period.name}</div>
                  <div className="text-muted-foreground text-sm">
                    {period.startDate} &mdash; {period.endDate}
                  </div>
                  {period.sportTypes && period.sportTypes.length > 0 && (
                    <div className="text-muted-foreground mt-1 text-xs">
                      {period.sportTypes.map(formatActivityType).join(", ")}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <TimePeriodDialog period={period}>
                    <DialogTrigger
                      render={<Button variant="ghost" size="icon-sm" />}
                    >
                      <PencilIcon className="size-3.5" />
                    </DialogTrigger>
                  </TimePeriodDialog>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      if (!athleteId) return;
                      deleteMutation.mutate({
                        athleteId,
                        id: period.id,
                      });
                    }}
                  >
                    <TrashIcon className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

interface TimePeriodFormData {
  name: string;
  startDate: string;
  endDate: string;
  sportTypes: string[];
}

function TimePeriodDialog({
  children,
  period,
}: {
  children: React.ReactNode;
  period?: {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
    sportTypes: string[] | null;
  };
}) {
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();
  const { allTypes: activityTypes } = useActivitiesQuery();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<TimePeriodFormData>({
    name: "",
    startDate: "",
    endDate: "",
    sportTypes: [],
  });

  // Populate the form when the dialog opens or targets a different period
  // (during render rather than in an effect, to avoid an extra render pass).
  const [prevState, setPrevState] = React.useState({ open, period });
  if (prevState.open !== open || prevState.period !== period) {
    setPrevState({ open, period });
    if (open && period) {
      setForm({
        name: period.name,
        startDate: period.startDate,
        endDate: period.endDate,
        sportTypes: period.sportTypes ?? [],
      });
    } else if (open) {
      setForm({ name: "", startDate: "", endDate: "", sportTypes: [] });
    }
  }

  const createMutation = trpc.timePeriods.create.useMutation({
    onSuccess: () => {
      void utils.timePeriods.invalidate();
      setOpen(false);
    },
  });
  const updateMutation = trpc.timePeriods.update.useMutation({
    onSuccess: () => {
      void utils.timePeriods.invalidate();
      setOpen(false);
    },
  });

  const handleSubmit = () => {
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
    <Dialog open={open} onOpenChange={setOpen}>
      {children}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {period ? "Edit Time Period" : "New Time Period"}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Name</Label>
              <input
                type="text"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="e.g. 2024 Season"
                className="border-border bg-background h-9 rounded-md border px-3 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label>Start Date</Label>
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
                <Label>End Date</Label>
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
                  Sport Types{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional, empty = all)
                  </span>
                </Label>
                <div className="grid grid-cols-2 gap-1.5">
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
                        <span className="truncate">
                          {formatActivityType(type)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                isSubmitting || !form.name || !form.startDate || !form.endDate
              }
            >
              {isSubmitting
                ? "Saving..."
                : period
                  ? "Update"
                  : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
