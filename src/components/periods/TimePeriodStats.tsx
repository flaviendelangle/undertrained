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
import { useT } from "~/i18n/useT";
import { formatHumanDuration, formatKm, formatMeters } from "~/utils/format";

interface TimePeriodStatsProps {
  activityCount: number;
  totalMovingTime: number;
  totalElapsedTime: number;
  totalDistance: number;
  totalElevation: number;
}

export function TimePeriodStats(props: TimePeriodStatsProps) {
  const t = useT();
  const {
    activityCount,
    totalMovingTime,
    totalElapsedTime,
    totalDistance,
    totalElevation,
  } = props;

  const avgDuration =
    activityCount > 0
      ? formatHumanDuration(Math.round(totalMovingTime / activityCount))
      : "0m 0s";

  return (
    <div className="md:border-border md:bg-card p-5 md:rounded-sm md:border">
      {/* Hero Row */}
      <div className="border-border mb-4 grid grid-cols-2 gap-2.5 border-b pb-4 md:grid-cols-4">
        <StatCard
          icon={ListIcon}
          label={t("periods.stats.activities")}
          value={activityCount}
          variant="hero"
        />
        <StatCard
          icon={Timer}
          label={t("periods.stats.movingTime")}
          value={formatHumanDuration(totalMovingTime)}
          variant="hero"
        />
        <StatCard
          icon={Route}
          label={t("periods.stats.distance")}
          value={formatKm(totalDistance)}
          variant="hero"
        />
        <StatCard
          icon={Mountain}
          label={t("periods.stats.elevation")}
          value={formatMeters(totalElevation)}
          variant="hero"
        />
      </div>

      {/* Grouped Sections */}
      <div className="flex flex-col gap-4">
        <StatSection icon={Clock} title={t("periods.stats.otherTotals")}>
          <StatCard
            label={t("periods.stats.elapsedTime")}
            value={formatHumanDuration(totalElapsedTime)}
          />
        </StatSection>

        {activityCount > 0 && (
          <StatSection
            icon={TrendingUp}
            title={t("periods.stats.averagesPerActivity")}
          >
            <StatCard
              label={t("periods.stats.avgDistance")}
              value={formatKm(totalDistance / activityCount)}
            />
            <StatCard
              label={t("periods.stats.avgDuration")}
              value={avgDuration}
            />
            <StatCard
              label={t("periods.stats.avgElevation")}
              value={formatMeters(totalElevation / activityCount)}
            />
          </StatSection>
        )}
      </div>
    </div>
  );
}
