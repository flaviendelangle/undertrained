import * as React from "react";

import { TrophyIcon } from "lucide-react";
import Link from "next/link";

import { formatCyclingSpeed, formatPace } from "~/components/charts/Records/format";
import { getMedalClasses } from "~/components/charts/Records/shared";
import { ChartCard } from "~/components/ui/chart-card";
import { useAthleteId } from "~/hooks/useAthleteId";
import type { AppMessageKey } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { CYCLING_POWER_DURATIONS } from "~/utils/cyclingPowerDurations";
import { CYCLING_SPEED_DISTANCES } from "~/utils/cyclingRecordDistances";
import { formatElapsed, formatKm, formatOrdinal } from "~/utils/format";
import { getActivityTypesByCategory, getSportConfig } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

import {
  type ActivityRanking,
  type RecordGroupKey,
  groupActivityRankings,
} from "./grouping";

const CYCLING_TYPES = getActivityTypesByCategory("cycling");

const GROUP_LABEL_KEY: Record<RecordGroupKey, AppMessageKey> = {
  power: "charts.personalRecords.group.power",
  speed: "charts.personalRecords.group.speed",
  heartRate: "charts.personalRecords.group.heartRate",
  climbing: "charts.personalRecords.group.climbing",
  overall: "charts.personalRecords.group.overall",
  bestEfforts: "charts.personalRecords.group.bestEfforts",
};

const durationLabel = (seconds: number) =>
  CYCLING_POWER_DURATIONS.find((d) => d.seconds === seconds)?.label ??
  formatElapsed(seconds);

const speedLabel = (meters: number) =>
  CYCLING_SPEED_DISTANCES.find((d) => d.meters === meters)?.label ??
  formatKm(meters, 0);

/**
 * "Personal records" card for the activity detail page: every leaderboard on
 * which this activity places in the all-time top 25, grouped by metric. Renders
 * nothing (no empty card) until the query resolves with at least one placing.
 */
export function ActivityPersonalRecords({
  stravaId,
  activityType,
}: {
  stravaId: number;
  activityType: string;
}) {
  const t = useT();
  const athleteId = useAthleteId();
  const { data } = trpc.records.getActivityRankings.useQuery(
    { athleteId: athleteId!, stravaId },
    { enabled: athleteId != null },
  );

  const groups = React.useMemo(
    () => groupActivityRankings(data ?? []),
    [data],
  );

  const isCycling = CYCLING_TYPES.includes(activityType);
  const sport = isCycling ? "cycling" : "running";
  const config = getSportConfig(activityType);

  // Formats a ranking's metric label + headline value + optional sub-value.
  const describe = (
    r: ActivityRanking,
  ): { label: string; value: string; sub?: string } => {
    switch (r.category) {
      case "power":
        return { label: durationLabel(r.paramKey as number), value: `${r.value} W` };
      case "heartrate":
        return {
          label: durationLabel(r.paramKey as number),
          value: `${r.value} bpm`,
        };
      case "speed": {
        const meters = r.distance ?? (r.paramKey as number);
        return {
          label: speedLabel(r.paramKey as number),
          value: formatElapsed(r.value),
          sub: r.value > 0 ? formatCyclingSpeed(meters / r.value) : undefined,
        };
      }
      case "biggestClimb":
        return {
          label: t("charts.records.metricLabel.biggestClimb"),
          value: `${Math.round(r.value)} m`,
        };
      case "totalElevation":
        return {
          label: t("charts.records.metricLabel.totalElevation"),
          value: `${Math.round(r.value)} m`,
        };
      case "distance":
        return {
          label: t("charts.records.metricLabel.distance"),
          value: config.formatPreciseDistance(r.value),
        };
      case "duration":
        return {
          label: t("charts.records.metricLabel.duration"),
          value: formatElapsed(r.value),
        };
      case "load":
        return {
          label: t("charts.records.metricLabel.load"),
          value: String(Math.round(r.value)),
        };
      case "runEffort": {
        const meters = r.distance ?? 0;
        return {
          label: String(r.paramKey),
          value: formatElapsed(r.value),
          sub:
            r.value > 0 && meters > 0
              ? formatPace(meters / r.value)
              : undefined,
        };
      }
    }
  };

  // Deep-link to the Personal Bests explorer, pre-selected to this metric/param.
  const href = (r: ActivityRanking): string => {
    const p = new URLSearchParams();
    switch (r.category) {
      case "power":
        p.set("sport", "cycling");
        p.set("metric", "power");
        p.set("duration", String(r.paramKey));
        break;
      case "speed":
        p.set("sport", "cycling");
        p.set("metric", "speed");
        p.set("distance", String(r.paramKey));
        break;
      case "heartrate":
        p.set("sport", sport);
        p.set("metric", "heartrate");
        p.set("duration", String(r.paramKey));
        break;
      case "biggestClimb":
        p.set("sport", "cycling");
        p.set("metric", "biggest_climb");
        break;
      case "totalElevation":
        p.set("sport", "cycling");
        p.set("metric", "elevation_total");
        break;
      case "distance":
        p.set("sport", sport);
        p.set("metric", "distance");
        break;
      case "duration":
        p.set("sport", sport);
        p.set("metric", "duration");
        break;
      case "load":
        p.set("sport", sport);
        p.set("metric", "load");
        break;
      case "runEffort":
        p.set("sport", "running");
        p.set("metric", "pace");
        p.set("name", String(r.paramKey));
        break;
    }
    return `/personal-bests?${p.toString()}`;
  };

  if (groups.length === 0) {
    return null;
  }

  return (
    <ChartCard
      title={t("charts.personalRecords.title")}
      info={t("charts.personalRecords.hint")}
      height="auto"
    >
      <div className="flex flex-col gap-5 p-4">
        {groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-2">
            <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {t(GROUP_LABEL_KEY[group.key])}
            </h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.rankings.map((r) => {
                const { label, value, sub } = describe(r);
                const isBest = r.rank === 1;
                return (
                  <Link
                    key={`${r.category}:${r.paramKey ?? ""}`}
                    href={href(r)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                      isBest
                        ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
                        : "border-border hover:bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 min-w-9 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums",
                        r.rank <= 3
                          ? getMedalClasses(r.rank)
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {formatOrdinal(r.rank)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-muted-foreground truncate text-xs">
                        {label}
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-foreground font-mono text-base font-bold whitespace-nowrap">
                          {value}
                        </span>
                        {sub && (
                          <span className="text-muted-foreground truncate text-xs">
                            {sub}
                          </span>
                        )}
                      </div>
                    </div>
                    {isBest && (
                      <TrophyIcon
                        className="size-4 shrink-0 text-amber-500"
                        aria-label={t("charts.personalRecords.allTimeBest")}
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </ChartCard>
  );
}
