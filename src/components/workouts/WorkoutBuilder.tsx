import * as React from "react";

import { Redo2Icon, Undo2Icon } from "lucide-react";
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
import { formatCompactDuration } from "~/utils/format";
import type { StructuredWorkout } from "~/utils/structuredWorkout";
import {
  STRUCTURED_WORKOUT_SCHEMA_VERSION,
  computeWorkoutMetrics,
  emptyWorkoutNodes,
  flattenWorkout,
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

  /**
   * Description + derived numbers. One block, rendered in the sidebar on
   * desktop and in a drawer on mobile — where there is no sidebar, and the
   * description would otherwise be unreachable entirely.
   */
  const details = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="workout-description">{t("workouts.description")}</Label>
        <textarea
          id="workout-description"
          rows={3}
          placeholder={t("workouts.descriptionPlaceholder")}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="border-input bg-background focus-visible:ring-ring resize-y rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-1"
        />
      </div>
      <WorkoutSummaryPanel
        metrics={metrics}
        segmentCount={segments.length}
        ftp={ftp}
      />
    </div>
  );

  return (
    // Capped and centered to match Statistics and the workouts list. Step rows
    // are one line of small fields; stretched across an ultrawide monitor the
    // duration and the watts end up a foot apart.
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col md:flex-row">
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

          <span className="min-w-0 flex-1" />

          {/* On a phone the details live in a drawer behind this chip, so the
              step list keeps the whole viewport. */}
          {isMobile && (
            <ResponsiveDialog>
              <ResponsiveDialogTrigger
                render={
                  <Button variant="outline" size="sm">
                    {formatCompactDuration(metrics.totalSeconds, {
                      subHour: "min",
                    })}
                    {metrics.tss != null && ftp != null
                      ? ` · ${metrics.tss}`
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
                <div className="p-4">{details}</div>
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
          selectedStepId={editor.selectedId}
          onSelectStep={(stepId) => editor.select(stepId)}
          className="h-32 shrink-0 md:h-48"
        />

        <div
          role="listbox"
          aria-label={t("workouts.myWorkouts")}
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {editor.nodes.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              {t("workouts.validation.empty")}
            </p>
          ) : (
            <StepList nodes={editor.nodes} editor={editor} ftp={ftp} />
          )}
        </div>

        <QuickAddBar editor={editor} />
      </div>

      {/* Rendered, not CSS-hidden: `details` owns a labelled `id`, and keeping
          a hidden copy mounted alongside the drawer's would put that id in the
          document twice and break the label association in both. */}
      {!isMobile && (
        <aside className="border-border shrink-0 overflow-y-auto border-l p-4 md:w-72 lg:w-80">
          {details}
        </aside>
      )}
    </div>
  );
}

/**
 * The few shortcuts worth having without a cheatsheet: undo/redo, arrow-key
 * selection, and delete. Everything else — grouping, duplicating, reordering —
 * is reachable from the row menu or by dragging, which is discoverable.
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
      const selected = current.selectedId;
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

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        current.selectRelative(event.key === "ArrowUp" ? -1 : 1);
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
