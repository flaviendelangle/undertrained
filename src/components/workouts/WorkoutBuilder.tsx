import * as React from "react";

import { KeyboardIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { useRouter } from "next/router";

import { useValueAsRef } from "@base-ui/utils/useValueAsRef";

import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "~/components/ui/responsive-dialog";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
import type { StructuredWorkout } from "~/utils/structuredWorkout";
import {
  STRUCTURED_WORKOUT_SCHEMA_VERSION,
  computeWorkoutMetrics,
  emptyWorkoutNodes,
  flattenWorkout,
  formatStepDuration,
  repeatSpans,
  structuredWorkoutSchema,
} from "~/utils/structuredWorkout";
import { trpc } from "~/utils/trpc";

import { QuickAddBar } from "./QuickAddBar";
import { StepList } from "./StepList";
import { WorkoutPreviewChart } from "./WorkoutPreviewChart";
import { WorkoutSportToggle } from "./WorkoutSportToggle";
import { WorkoutSummaryPanel } from "./WorkoutSummaryPanel";
import { useWorkoutEditor } from "./useWorkoutEditor";

/**
 * Create/edit shell for a structured workout, following `RouteBuilder`: local
 * state with an undo stack, create-vs-edit driven by an optional prop, and a
 * save that returns to the library.
 */

export interface WorkoutBuilderProps {
  workout?: {
    id: number;
    name: string;
    description: string | null;
    sport: string;
    structure: StructuredWorkout;
  };
}

function emptyWorkout(): StructuredWorkout {
  return {
    version: STRUCTURED_WORKOUT_SCHEMA_VERSION,
    sport: "bike",
    nodes: emptyWorkoutNodes(),
  };
}

export function WorkoutBuilder({ workout }: WorkoutBuilderProps) {
  const t = useT();
  const router = useRouter();
  const athleteId = useAthleteId();
  const isMobile = useIsMobile();
  const { currentSettings, hasSettings } = useRiderSettingsTimeline();

  // Never fall back to the 200 W default: a fabricated watt figure beside a
  // real percentage reads as fact.
  const ftp = hasSettings ? currentSettings.ftp : null;

  const [name, setName] = React.useState(workout?.name ?? "");
  const [description, setDescription] = React.useState(
    workout?.description ?? "",
  );
  const editor = useWorkoutEditor(workout?.structure ?? emptyWorkout());

  const segments = React.useMemo(
    () => flattenWorkout(editor.workout),
    [editor.workout],
  );
  const spans = React.useMemo(() => repeatSpans(segments), [segments]);
  const metrics = React.useMemo(
    // IF is FTP-independent, so an assumed FTP still yields a usable number for
    // it even when the watt-denominated stats are suppressed downstream.
    () => computeWorkoutMetrics(segments, ftp ?? currentSettings.ftp),
    [segments, ftp, currentSettings.ftp],
  );

  const utils = trpc.useUtils();
  const onSaved = () => {
    void utils.structuredWorkouts.list.invalidate();
    void router.push("/workouts");
  };
  const createMutation = trpc.structuredWorkouts.create.useMutation({
    onSuccess: onSaved,
  });
  const updateMutation = trpc.structuredWorkouts.update.useMutation({
    onSuccess: onSaved,
  });
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const validation = structuredWorkoutSchema.safeParse(editor.workout);
  const canSave =
    !!athleteId && name.trim() !== "" && validation.success && !isSaving;

  const save = () => {
    if (!athleteId || !validation.success) return;
    const payload = {
      athleteId,
      name: name.trim(),
      description: description.trim() === "" ? null : description.trim(),
      sport: editor.sport,
      structure: validation.data,
      estimatedTss: ftp == null ? null : metrics.tss,
      ftpAtSave: ftp,
    };
    if (workout) updateMutation.mutate({ ...payload, id: workout.id });
    else createMutation.mutate(payload);
  };

  useEditorShortcuts(editor);

  const summary = (
    <WorkoutSummaryPanel
      metrics={metrics}
      segmentCount={segments.length}
      ftp={ftp}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="border-border bg-background sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b p-2">
          <input
            type="text"
            aria-label={t("workouts.name")}
            placeholder={t("workouts.namePlaceholder")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            // Full width on its own row below `md`: sharing a row with the
            // sport toggle squeezes the name down to a few characters at 390 px.
            className="border-input bg-background focus-visible:ring-ring h-9 w-full min-w-0 rounded-md border px-3 text-sm outline-none focus-visible:ring-1 md:w-auto md:flex-1"
          />
          <WorkoutSportToggle value={editor.sport} onChange={editor.setSport} />

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("workouts.undo")}
            disabled={!editor.canUndo}
            onClick={editor.undo}
          >
            <Undo2Icon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("workouts.redo")}
            disabled={!editor.canRedo}
            onClick={editor.redo}
          >
            <Redo2Icon />
          </Button>
          <KeyboardShortcutsButton />

          {/* On a phone the summary lives in a drawer behind this chip, so the
              step list keeps the whole viewport. */}
          {isMobile && (
            <ResponsiveDialog>
              <ResponsiveDialogTrigger
                render={
                  <Button variant="outline" size="sm">
                    {formatStepDuration(metrics.totalSeconds)}
                    {metrics.tss != null && ftp != null
                      ? ` · ${metrics.tss} TSS`
                      : ""}
                  </Button>
                }
              />
              <ResponsiveDialogContent>
                <ResponsiveDialogHeader>
                  <ResponsiveDialogTitle>
                    {t("workouts.summary.title")}
                  </ResponsiveDialogTitle>
                </ResponsiveDialogHeader>
                <div className="p-4">{summary}</div>
              </ResponsiveDialogContent>
            </ResponsiveDialog>
          )}

          <Button size="sm" disabled={!canSave} onClick={save}>
            {isSaving
              ? t("workouts.saving")
              : workout
                ? t("workouts.updateWorkout")
                : t("workouts.saveWorkout")}
          </Button>
        </div>

        <WorkoutPreviewChart
          segments={segments}
          spans={spans}
          ftp={ftp}
          selectedStepId={editor.selectedIds.at(-1) ?? null}
          onSelectStep={(stepId) => editor.select(stepId)}
          className="h-32 shrink-0 md:h-48"
        />

        <div
          role="listbox"
          aria-label={t("workouts.myWorkouts")}
          aria-multiselectable
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {editor.nodes.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              {t("workouts.validation.empty")}
            </p>
          ) : (
            <StepList nodes={editor.nodes} editor={editor} ftp={ftp} />
          )}

          {editor.groupError && (
            <p role="alert" className="text-destructive p-2 text-xs">
              {editor.groupError === "too-deep"
                ? t("workouts.repeat.maxDepth", { depth: 3 })
                : t("workouts.repeat.notContiguous")}
            </p>
          )}
        </div>

        <QuickAddBar editor={editor} />
      </div>

      <aside className="border-border hidden shrink-0 overflow-y-auto border-l p-4 md:block md:w-80">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workout-description">
              {t("workouts.description")}
            </Label>
            <textarea
              id="workout-description"
              rows={3}
              placeholder={t("workouts.descriptionPlaceholder")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="border-input bg-background focus-visible:ring-ring resize-y rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-1"
            />
          </div>
          {summary}
        </div>
      </aside>
    </div>
  );
}

function KeyboardShortcutsButton() {
  const t = useT();
  const rows: [string, string][] = [
    ["↑ / ↓", t("workouts.keyboard.move")],
    ["Alt + ↑ / ↓", t("workouts.keyboard.reorder")],
    ["Enter", t("workouts.keyboard.duplicate")],
    ["Delete", t("workouts.keyboard.remove")],
    ["Ctrl/⌘ + G", t("workouts.keyboard.group")],
    ["Ctrl/⌘ + ⇧ + G", t("workouts.keyboard.ungroup")],
    ["Ctrl/⌘ + Z", t("workouts.keyboard.undo")],
    ["⇧ + click", t("workouts.keyboard.multiSelect")],
  ];

  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("workouts.keyboard.title")}
          >
            <KeyboardIcon />
          </Button>
        }
      />
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("workouts.keyboard.title")}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <dl className="flex flex-col gap-2 p-4 text-sm">
          {rows.map(([keys, description]) => (
            <div key={keys} className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground font-mono text-xs">
                {keys}
              </dt>
              <dd className="text-right">{description}</dd>
            </div>
          ))}
        </dl>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * Document-level shortcuts for the step list.
 *
 * Bound on the document rather than a focused container because the fields
 * inside a row take focus as soon as anything is edited; the guard below is what
 * keeps them from stealing keystrokes meant for a text input.
 */
function useEditorShortcuts(editor: ReturnType<typeof useWorkoutEditor>) {
  const editorRef = useValueAsRef(editor);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextEntry =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      const current = editorRef.current;
      const selected = current.selectedIds.at(-1) ?? null;
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) current.redo();
        else current.undo();
        return;
      }

      // Everything below moves or edits the selection, so it must not fire
      // while someone is typing a duration or a percentage.
      if (isTextEntry) return;

      if (mod && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey && selected) current.ungroup(selected);
        else current.group();
        return;
      }

      if (mod && event.key.toLowerCase() === "d") {
        if (!selected) return;
        event.preventDefault();
        current.duplicate(selected);
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const delta = event.key === "ArrowUp" ? -1 : 1;
        event.preventDefault();
        if (event.altKey) {
          if (selected) current.move(selected, delta);
        } else {
          current.selectRelative(delta);
        }
        return;
      }

      if (event.key === "Enter" && selected) {
        event.preventDefault();
        current.duplicate(selected);
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selected) {
        event.preventDefault();
        current.remove(selected);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
