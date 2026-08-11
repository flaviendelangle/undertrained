import * as React from "react";

import {
  AlertTriangleIcon,
  CheckIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { CalendarSubscription } from "@server/db/types";

import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "~/components/ui/field";
import { Label } from "~/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { Switch } from "~/components/ui/switch";
import { showErrorToast } from "~/components/ui/toast";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useBusyCalendars } from "~/hooks/useBusyCalendars";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { trpc } from "~/utils/trpc";

/** Preset swatches offered when adding/editing a calendar (stored as #rrggbb). */
const CALENDAR_COLORS = [
  "#64748b", // slate
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#f59e0b", // amber
  "#f43f5e", // rose
] as const;

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Add (no `existing`) or edit a calendar — name, iCal URL, colour. */
function CalendarForm({
  existing,
  onClose,
}: {
  existing?: CalendarSubscription;
  onClose: () => void;
}) {
  const t = useT();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();

  const [name, setName] = React.useState(existing?.name ?? "");
  const [url, setUrl] = React.useState(existing?.icalUrl ?? "");
  const [color, setColor] = React.useState<string>(
    existing?.color ?? CALENDAR_COLORS[0],
  );
  const [error, setError] = React.useState<string | null>(null);

  const invalidate = () => {
    void utils.calendarSubscriptions.list.invalidate();
    void utils.calendarSubscriptions.events.invalidate();
  };
  const onError = () => setError(t("journal.calendars.saveError"));

  const createMut = trpc.calendarSubscriptions.create.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError,
  });
  const updateMut = trpc.calendarSubscriptions.update.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError,
  });
  const pending = createMut.isPending || updateMut.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = parseHttpUrl(url);
    if (!parsed) {
      setError(t("journal.calendars.invalidUrl"));
      return;
    }
    const finalName = name.trim() || parsed.hostname;
    if (existing) {
      updateMut.mutate({
        athleteId: athleteId!,
        id: existing.id,
        name: finalName,
        icalUrl: parsed.toString(),
        color,
      });
    } else {
      createMut.mutate({
        athleteId: athleteId!,
        name: finalName,
        icalUrl: parsed.toString(),
        color,
      });
    }
  };

  return (
    <form
      onSubmit={submit}
      className="border-border flex flex-col gap-3 rounded-md border p-3"
    >
      <Field
        name="icalUrl"
        validationMode="onBlur"
        validate={(value) =>
          parseHttpUrl(String(value)) ? null : t("journal.calendars.invalidUrl")
        }
      >
        <FieldLabel className="text-xs">
          {t("journal.calendars.url")}
        </FieldLabel>
        <FieldControl
          required
          type="url"
          inputMode="url"
          autoFocus
          value={url}
          onValueChange={setUrl}
          placeholder={t("journal.calendars.urlPlaceholder")}
        />
        <FieldDescription className="text-[11px]">
          {t("journal.calendars.urlHint")}
        </FieldDescription>
        <FieldError />
      </Field>

      <Field name="name">
        <FieldLabel className="text-xs">
          {t("journal.calendars.name")}
        </FieldLabel>
        <FieldControl
          type="text"
          value={name}
          onValueChange={setName}
          placeholder={t("journal.calendars.namePlaceholder")}
        />
      </Field>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">{t("journal.calendars.color")}</Label>
        <RadioGroup
          aria-label={t("journal.calendars.color")}
          value={color}
          onValueChange={setColor}
          className="flex items-center gap-1.5"
        >
          {CALENDAR_COLORS.map((swatch) => (
            <Radio.Root
              key={swatch}
              value={swatch}
              aria-label={swatch}
              style={{ backgroundColor: swatch }}
              className="data-checked:ring-foreground/40 ring-offset-background flex size-6 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 data-checked:scale-100 data-checked:ring-2 data-checked:ring-offset-2"
            >
              <Radio.Indicator>
                <CheckIcon className="size-3.5 text-white drop-shadow" />
              </Radio.Indicator>
            </Radio.Root>
          ))}
        </RadioGroup>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={pending}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

/** One calendar in the list: colour dot, name, sync warning, edit, visibility. */
function CalendarRow({
  calendar,
  dimmed,
  onEdit,
}: {
  calendar: CalendarSubscription;
  /** Master switch is off — the per-calendar toggle still works but reads muted. */
  dimmed: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const { isHidden, toggleHidden } = useBusyCalendars();
  const hidden = isHidden(calendar.id);

  return (
    <div className={cn("flex items-center gap-2", dimmed && "opacity-60")}>
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-full"
        style={{ backgroundColor: calendar.color }}
      />
      <span className="text-foreground min-w-0 flex-1 truncate text-sm">
        {calendar.name}
      </span>
      {calendar.lastError && (
        <span title={t("journal.calendars.loadError")}>
          <AlertTriangleIcon className="size-3.5 shrink-0 text-amber-500" />
        </span>
      )}
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={onEdit}
        aria-label={t("journal.calendars.editTitle")}
      >
        <PencilIcon />
      </Button>
      <Switch
        size="sm"
        checked={!hidden}
        onCheckedChange={() => toggleHidden(calendar.id)}
        aria-label={
          hidden
            ? t("journal.calendars.show", { name: calendar.name })
            : t("journal.calendars.hide", { name: calendar.name })
        }
      />
    </div>
  );
}

/**
 * Manage + quick-toggle the external-calendar busy overlay: a master switch, a
 * per-calendar list with show/hide toggles, and add/edit/remove. The disclaimer
 * keeps the feature's intent explicit — these are availability hints, not training.
 */
export function CalendarOverlayPanel() {
  const t = useT();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();
  const { masterEnabled, setMasterEnabled } = useBusyCalendars();

  const { data: calendars } = trpc.calendarSubscriptions.list.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );

  // `null` = list view; "new" = add form; a row = edit form for that calendar.
  const [editing, setEditing] = React.useState<
    CalendarSubscription | "new" | null
  >(null);

  const removeMut = trpc.calendarSubscriptions.remove.useMutation({
    onSuccess: () => {
      void utils.calendarSubscriptions.list.invalidate();
      void utils.calendarSubscriptions.events.invalidate();
      setEditing(null);
    },
    onError: () => showErrorToast(t("common.deleteError")),
  });

  return (
    <div className="flex flex-col gap-4">
      <label className="flex cursor-pointer items-center justify-between">
        <span className="text-foreground text-sm font-medium">
          {t("journal.calendars.showAll")}
        </span>
        <Switch checked={masterEnabled} onCheckedChange={setMasterEnabled} />
      </label>

      <p className="text-muted-foreground text-[11px] leading-snug">
        {t("journal.calendars.disclaimer")}
      </p>

      {calendars && calendars.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {calendars.map((calendar) =>
            editing !== "new" &&
            typeof editing === "object" &&
            editing?.id === calendar.id ? (
              <div key={calendar.id} className="flex flex-col gap-2">
                <CalendarForm
                  existing={calendar}
                  onClose={() => setEditing(null)}
                />
                <ConfirmDialog
                  trigger={
                    <Button type="button" variant="destructive" size="sm">
                      <Trash2Icon />
                      {t("journal.calendars.remove")}
                    </Button>
                  }
                  title={t("common.deleteConfirmTitle", {
                    name: calendar.name,
                  })}
                  description={t("common.deleteConfirmDescription")}
                  confirmLabel={t("journal.calendars.remove")}
                  pendingLabel={t("common.deleting")}
                  onConfirm={() =>
                    removeMut.mutateAsync({
                      athleteId: athleteId!,
                      id: calendar.id,
                    })
                  }
                />
              </div>
            ) : (
              <CalendarRow
                key={calendar.id}
                calendar={calendar}
                dimmed={!masterEnabled}
                onEdit={() => setEditing(calendar)}
              />
            ),
          )}
        </div>
      )}

      {calendars?.length === 0 && editing !== "new" && (
        <p className="text-muted-foreground text-xs">
          {t("journal.calendars.empty")}
        </p>
      )}

      {editing === "new" ? (
        <CalendarForm onClose={() => setEditing(null)} />
      ) : (
        editing == null && (
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            <PlusIcon />
            {t("journal.calendars.add")}
          </Button>
        )
      )}
    </div>
  );
}

/**
 * Controlled dialog wrapper around {@link CalendarOverlayPanel}, for opening the
 * manager from elsewhere (e.g. the Journal overflow menu). The toolbar entry point
 * uses {@link CalendarOverlayPopover} instead.
 */
export function CalendarOverlayDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("journal.calendars.title")}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            {t("journal.calendars.disclaimer")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <CalendarOverlayPanel />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
