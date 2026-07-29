import { PlusIcon, RepeatIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useT } from "~/i18n/useT";

import type { WorkoutEditor } from "./useWorkoutEditor";

/**
 * The add row, pinned to the bottom of the list.
 *
 * Two actions, no menu. A new step already inherits the previous one's duration
 * and flips its intensity, so the fastest way to build anything is to add and
 * adjust rather than to pick from a list of shapes.
 */
export function QuickAddBar({ editor }: { editor: WorkoutEditor }) {
  const t = useT();

  return (
    <div className="border-border bg-background flex items-center gap-1.5 border-t p-2">
      <Button size="sm" variant="outline" onClick={() => editor.addStep()}>
        <PlusIcon /> {t("workouts.step.add")}
      </Button>
      <Button size="sm" variant="outline" onClick={editor.addRepeat}>
        <RepeatIcon /> {t("workouts.step.addRepeat")}
      </Button>
    </div>
  );
}
