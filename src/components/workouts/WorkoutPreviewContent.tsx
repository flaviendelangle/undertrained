import Link from "next/link";

import { QueryState } from "~/components/primitives/QueryState";
import { Button } from "~/components/ui/button";
import {
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
import {
  type StructuredWorkout,
  type WorkoutNode,
  describePowerTarget,
  formatStepDuration,
} from "~/utils/structuredWorkout";
import { hasPowerTarget } from "~/utils/structuredWorkout/types";

function WorkoutSteps({ nodes }: { nodes: WorkoutNode[] }) {
  const t = useT();
  return (
    <ol className="divide-border divide-y">
      {nodes.map((node) => (
        <li key={node.id} className="py-2 text-sm">
          {node.type === "repeat" ? (
            <div className="border-border border-l-2 pl-3">
              <p className="mb-1 font-medium">{node.reps} ×</p>
              <WorkoutSteps nodes={node.children} />
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-4 font-medium tabular-nums">
                <span>{formatStepDuration(node.durationSeconds)}</span>
                <span>
                  {node.power.kind === "free"
                    ? t("liveTraining.workout.freeRide")
                    : describePowerTarget(node.power)}
                  {node.cadence != null && ` · ${node.cadence} rpm`}
                </span>
              </div>
              {node.note && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {node.note}
                </p>
              )}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

export function WorkoutPreviewContent({
  name,
  description,
  structure,
  startHref,
  loading = false,
  error = false,
  onRetry,
}: {
  name: string;
  description?: string | null;
  structure?: StructuredWorkout;
  startHref: string;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const t = useT();
  const { configuredFtp } = useRiderSettingsTimeline();
  const missingFtp =
    structure &&
    hasPowerTarget(structure.nodes, ["pct", "ramp"]) &&
    configuredFtp == null;
  return (
    <ResponsiveDialogContent className="max-h-[90svh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl">
      <ResponsiveDialogHeader className="shrink-0 pr-8">
        <ResponsiveDialogTitle>{name}</ResponsiveDialogTitle>
      </ResponsiveDialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {description && (
          <ResponsiveDialogDescription className="mb-4">
            {description}
          </ResponsiveDialogDescription>
        )}
        {error ? (
          <QueryState error onRetry={onRetry} />
        ) : loading ? (
          <QueryState loading />
        ) : (
          structure && <WorkoutSteps nodes={structure.nodes} />
        )}
      </div>
      {structure &&
        !error &&
        !loading &&
        (missingFtp ? (
          <p className="text-sm">
            {t("workouts.ftpRequired")}{" "}
            <Link href="/settings" className="text-primary underline">
              {t("common.openSettings")}
            </Link>
          </p>
        ) : (
          <Button nativeButton={false} render={<Link href={startHref} />}>
            {t("workouts.startWorkout")}
          </Button>
        ))}
    </ResponsiveDialogContent>
  );
}
