import {
  Clock,
  ListIcon,
  Mountain,
  Route,
  Timer,
  TrendingUp,
} from "lucide-react";

import { StatCard } from "~/components/primitives/StatCard";
import { StatSection } from "~/components/primitives/StatSection";
import { formatHumanDuration } from "~/utils/format";

interface TimePeriodStatsProps {
  activityCount: number;
  totalMovingTime: number;
  totalElapsedTime: number;
  totalDistance: number;
  totalElevation: number;
}

export function TimePeriodStats(props: TimePeriodStatsProps) {
  const {
    activityCount,
    totalMovingTime,
    totalElapsedTime,
    totalDistance,
    totalElevation,
  } = props;

  const avgDistance =
    activityCount > 0 ? (totalDistance / 1000 / activityCount).toFixed(1) : "0";
  const avgDuration =
    activityCount > 0
      ? formatHumanDuration(Math.round(totalMovingTime / activityCount))
      : "0m 0s";

  return (
    <div className="border-border bg-card rounded-sm border p-5 max-sm:border-0">
      {/* Hero Row */}
      <div className="border-border mb-4 grid grid-cols-2 gap-2.5 border-b pb-4 md:grid-cols-4">
        <StatCard
          icon={ListIcon}
          label="Activities"
          value={activityCount}
          variant="hero"
        />
        <StatCard
          icon={Timer}
          label="Moving Time"
          value={formatHumanDuration(totalMovingTime)}
          variant="hero"
        />
        <StatCard
          icon={Route}
          label="Distance"
          value={`${(totalDistance / 1000).toFixed(1)} km`}
          variant="hero"
        />
        <StatCard
          icon={Mountain}
          label="Elevation"
          value={`${Math.round(totalElevation)} m`}
          variant="hero"
        />
      </div>

      {/* Grouped Sections */}
      <div className="flex flex-col gap-4">
        <StatSection icon={Clock} title="Other totals">
          <StatCard
            label="Elapsed Time"
            value={formatHumanDuration(totalElapsedTime)}
          />
        </StatSection>

        {activityCount > 0 && (
          <StatSection icon={TrendingUp} title="Averages per Activity">
            <StatCard label="Avg Distance" value={`${avgDistance} km`} />
            <StatCard label="Avg Duration" value={avgDuration} />
            <StatCard
              label="Avg Elevation"
              value={`${activityCount > 0 ? Math.round(totalElevation / activityCount) : 0} m`}
            />
          </StatSection>
        )}
      </div>
    </div>
  );
}
