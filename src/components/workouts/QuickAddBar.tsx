import {
  ChevronDownIcon,
  FlameIcon,
  PlusIcon,
  RepeatIcon,
  SnowflakeIcon,
  WandSparklesIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useT } from "~/i18n/useT";
import { WORKOUT_PRESETS } from "~/utils/structuredWorkout";

import type { WorkoutEditor } from "./useWorkoutEditor";

/**
 * The add row, pinned to the bottom of the list.
 *
 * Only the two everyday actions get a button; warm-up, cool-down and the
 * presets go behind one menu so the bar stays a single row at 360 px. A bar
 * that wraps to two rows costs more vertical space than the steps it sits under.
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

      <div className="min-w-0 flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="sm" variant="ghost">
              <WandSparklesIcon />
              {t("workouts.step.more")}
              <ChevronDownIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() =>
              editor.addStep({
                durationSeconds: 600,
                power: { kind: "ramp", from: 0.45, to: 0.7 },
                intensity: "warmup",
              })
            }
          >
            <FlameIcon /> {t("workouts.step.addWarmup")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              editor.addStep({
                durationSeconds: 480,
                power: { kind: "ramp", from: 0.6, to: 0.4 },
                intensity: "cooldown",
              })
            }
          >
            <SnowflakeIcon /> {t("workouts.step.addCooldown")}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          {/* The label has to live inside the group: it renders Base UI's
              `Menu.GroupLabel`, which throws when it has no group to label. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("workouts.preset.label")}</DropdownMenuLabel>
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
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
