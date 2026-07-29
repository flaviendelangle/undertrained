import {
  ChevronDownIcon,
  FlameIcon,
  PlusIcon,
  RepeatIcon,
  SnowflakeIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useT } from "~/i18n/useT";
import { WORKOUT_PRESETS } from "~/utils/structuredWorkout";

import type { WorkoutEditor } from "./useWorkoutEditor";

/**
 * The add row. Warm-up and cool-down are separate buttons rather than a role
 * dropdown on a generic step because every workout has exactly one of each and
 * they always look the same — a ramp in, a ramp out.
 */
export function QuickAddBar({ editor }: { editor: WorkoutEditor }) {
  const t = useT();

  return (
    <div className="border-border bg-background flex flex-wrap items-center gap-1.5 border-t p-2">
      <Button size="sm" variant="outline" onClick={() => editor.addStep()}>
        <PlusIcon /> {t("workouts.step.add")}
      </Button>
      <Button size="sm" variant="outline" onClick={editor.addRepeat}>
        <RepeatIcon /> {t("workouts.step.addRepeat")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t("workouts.step.addWarmup")}
        onClick={() =>
          editor.addStep({
            durationSeconds: 600,
            power: { kind: "ramp", from: 0.45, to: 0.7 },
            intensity: "warmup",
          })
        }
      >
        <FlameIcon />
        <span className="hidden sm:inline">{t("workouts.step.addWarmup")}</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t("workouts.step.addCooldown")}
        onClick={() =>
          editor.addStep({
            durationSeconds: 480,
            power: { kind: "ramp", from: 0.6, to: 0.4 },
            intensity: "cooldown",
          })
        }
      >
        <SnowflakeIcon />
        <span className="hidden sm:inline">
          {t("workouts.step.addCooldown")}
        </span>
      </Button>

      <div className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="sm" variant="ghost">
              {t("workouts.step.preset")}
              <ChevronDownIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {WORKOUT_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.id}
              onClick={() => editor.replaceNodes(preset.build())}
            >
              <span className="flex flex-col">
                <span>{t(preset.labelKey)}</span>
                <span className="text-muted-foreground text-xs">
                  {t(preset.descriptionKey)}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
