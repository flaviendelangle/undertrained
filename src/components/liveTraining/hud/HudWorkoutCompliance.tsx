import * as React from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { cn } from "~/lib/utils";
import type { SessionDataPoint } from "~/sensors/types";
import type { ResolvedSegment } from "~/utils/structuredWorkout";
import {
  computeSegmentStats,
  formatStepDuration,
  overallCompliance,
} from "~/utils/structuredWorkout";

/**
 * How closely the ride matched the plan.
 *
 * The headline number covers work steps only (see `COMPLIANCE_MIN_PCT`):
 * riders coast through recoveries, so counting them would measure obedience to
 * a number nobody intends to hold.
 */

interface HudWorkoutComplianceProps {
  dataPoints: readonly SessionDataPoint[];
  segments: readonly ResolvedSegment[];
}

export function HudWorkoutCompliance({
  dataPoints,
  segments,
}: HudWorkoutComplianceProps) {
  const t = useT();
  const tokens = useChartTokens();

  const stats = React.useMemo(
    () => computeSegmentStats(dataPoints, segments),
    [dataPoints, segments],
  );
  const headline = React.useMemo(() => overallCompliance(stats), [stats]);

  if (stats.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {headline != null && (
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-3xl font-bold tabular-nums">
            {Math.round(headline * 100)}%
          </span>
          <span className="text-muted-foreground text-sm">
            {t("liveTraining.workout.compliance")}
          </span>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        {t("liveTraining.workout.complianceHint")}
      </p>

      <div className="max-h-64 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {t("liveTraining.workout.segmentTable.step")}
              </TableHead>
              <TableHead>
                {t("liveTraining.workout.segmentTable.target")}
              </TableHead>
              <TableHead>
                {t("liveTraining.workout.segmentTable.actual")}
              </TableHead>
              <TableHead>
                {t("liveTraining.workout.segmentTable.delta")}
              </TableHead>
              <TableHead>
                {t("liveTraining.workout.segmentTable.cadence")}
              </TableHead>
              <TableHead>
                {t("liveTraining.workout.segmentTable.onTarget")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((stat) => (
              <TableRow key={stat.segmentIndex}>
                <TableCell className="whitespace-nowrap">
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-block size-2 rounded-full align-middle"
                    style={{
                      backgroundColor: tokens.zones[stat.segment.zoneIndex],
                    }}
                  />
                  {formatStepDuration(stat.segment.durationSeconds)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {stat.avgTargetPower != null
                    ? `${stat.avgTargetPower} W`
                    : "—"}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {stat.avgPower != null ? `${stat.avgPower} W` : "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "font-mono tabular-nums",
                    stat.deltaWatts == null
                      ? undefined
                      : stat.deltaWatts >= 0
                        ? "text-emerald-500"
                        : "text-red-400",
                  )}
                >
                  {stat.deltaWatts == null
                    ? "—"
                    : `${stat.deltaWatts > 0 ? "+" : ""}${stat.deltaWatts}`}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {stat.avgCadence != null ? stat.avgCadence : "—"}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {stat.compliance == null
                    ? "—"
                    : `${Math.round(stat.compliance * 100)}%`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
