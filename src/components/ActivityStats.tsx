import * as React from "react";

import {
  Clock,
  Flame,
  Gauge,
  HeartPulse,
  Mountain,
  Route,
  Timer,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Activity } from "@server/db/types";

import { CardTitle } from "~/components/primitives/CardTitle";
import { SettingsCallout } from "~/components/primitives/SettingsCallout";
import { StatCard } from "~/components/primitives/StatCard";
import { StatSection } from "~/components/primitives/StatSection";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { cn } from "~/lib/utils";
import { formatHumanDuration } from "~/utils/format";
import { getActivityLoad, getLoadPreferences } from "~/utils/getActivityLoad";
import { getSportConfig } from "~/utils/sportConfig";

interface Stat {
  label: string;
  value: string | number | null;
  icon?: LucideIcon;
  tooltip?: ReactNode;
}

interface ActivityStatsProps {
  activity: Activity;
}

export const ActivityStats = React.memo(function ActivityStats({
  activity,
}: ActivityStatsProps) {
  const sportConfig = getSportConfig(activity.type);
  const { resolveForDate, hasSettings, timeline } = useRiderSettingsTimeline();
  const activityDate = activity.startDateLocal.slice(0, 10);
  const riderSettings = resolveForDate(activityDate);

  const np = activity.weightedAverageWatts ?? null;
  const ftp = riderSettings.ftp;
  const intensityFactor =
    sportConfig.hasPowerMetrics && np != null ? np / ftp : null;
  const tss =
    sportConfig.hasPowerMetrics || sportConfig.hasPaceTSS
      ? (activity.tss ?? null)
      : null;
  const hrss = activity.hrss ?? null;

  const tssTooltipLines = sportConfig.getTssTooltipLines(riderSettings, np);
  const tssTooltip = (
    <div className="flex flex-col gap-0.5">
      <div className="font-medium">Settings for {activityDate}</div>
      {tssTooltipLines.map((line) => (
        <div key={line.label}>
          {line.label}: {line.value}
        </div>
      ))}
    </div>
  );

  const hrSettingsTooltip = (
    <div className="flex flex-col gap-0.5">
      <div className="font-medium">Settings for {activityDate}</div>
      <div>Resting HR: {riderSettings.restingHr} bpm</div>
      <div>Max HR: {riderSettings.maxHr} bpm</div>
      <div>LTHR: {riderSettings.lthr} bpm</div>
    </div>
  );

  // ── Hero stats ──

  const heroStats: Stat[] = [
    {
      icon: Timer,
      label: "Moving Time",
      value: formatHumanDuration(activity.movingTime),
    },
    ...(activity.distance > 0
      ? [
          {
            icon: Route,
            label: "Distance",
            value: sportConfig.formatDistance(activity.distance),
          },
        ]
      : []),
    ...(sportConfig.heroThirdStat === "pace" && activity.averageSpeed > 0
      ? [
          {
            icon: Gauge,
            label: `Avg ${sportConfig.speedLabel}`,
            value: sportConfig.formatSpeed(activity.averageSpeed),
          },
        ]
      : activity.totalElevationGain > 0
        ? [
            {
              icon: Mountain,
              label: "Elevation",
              value: `${activity.totalElevationGain} m`,
            },
          ]
        : []),
    ...(() => {
      const loadResult = getActivityLoad(activity, getLoadPreferences(timeline));
      return loadResult.value != null
        ? [
            {
              icon: TrendingUp,
              label: "Load",
              value: Math.round(loadResult.value).toString(),
              tooltip: loadResult.tooltip,
            },
          ]
        : [];
    })(),
  ];

  // ── Time & Speed ──

  const timeSpeedStats: Stat[] = [
    {
      label: "Elapsed Time",
      value: formatHumanDuration(activity.elapsedTime),
    },
    ...(activity.averageSpeed > 0
      ? [
          {
            label: `Avg ${sportConfig.speedLabel}`,
            value: sportConfig.formatSpeed(activity.averageSpeed),
          },
        ]
      : []),
    ...(activity.maxSpeed != null && activity.maxSpeed > 0
      ? [
          {
            label: `Max ${sportConfig.speedLabel}`,
            value: sportConfig.formatSpeed(activity.maxSpeed),
          },
        ]
      : []),
  ];

  // ── Heart Rate ──

  const heartRateStats: Stat[] = [
    ...(activity.averageHeartrate != null
      ? [
          {
            label: "Avg HR",
            value: `${Math.round(activity.averageHeartrate)} bpm`,
          },
        ]
      : []),
    ...(activity.maxHeartrate != null
      ? [
          {
            label: "Max HR",
            value: `${Math.round(activity.maxHeartrate)} bpm`,
          },
        ]
      : []),
  ];

  // ── Power ──

  const powerStats: Stat[] = [
    ...(activity.averageWatts != null
      ? [
          {
            label: "Avg Power",
            value: `${Math.round(activity.averageWatts)} W`,
          },
        ]
      : []),
    ...(activity.maxWatts != null
      ? [
          {
            label: "Max Power",
            value: `${Math.round(activity.maxWatts)} W`,
          },
        ]
      : []),
    ...(np != null
      ? [
          {
            label: "Normalized Power",
            value: `${Math.round(np)} W`,
          },
        ]
      : []),
  ];

  // ── Energy & Cadence ──

  const energyCadenceStats: Stat[] = [
    ...(activity.kilojoules != null
      ? [{ label: "Energy", value: `${Math.round(activity.kilojoules)} kJ` }]
      : []),
    ...(activity.calories != null
      ? [
          {
            label: "Calories",
            value: `${Math.round(activity.calories)} kcal`,
          },
        ]
      : []),
    ...(activity.averageCadence != null
      ? [
          {
            label: "Avg Cadence",
            value: `${Math.round(activity.averageCadence)} ${sportConfig.cadenceUnit}`,
          },
        ]
      : []),
  ];

  // ── Training Load ──

  const tssLabel = sportConfig.tssLabel;
  const tssSettingsHint = sportConfig.tssSettingsHint;

  const trainingLoadStats: Stat[] = hasSettings
    ? [
        ...(intensityFactor != null
          ? [
              {
                label: "Intensity Factor",
                value: intensityFactor.toFixed(2),
                tooltip: tssTooltip,
              },
            ]
          : []),
        ...(tss != null
          ? [
              {
                label: tssLabel,
                value: Math.round(tss).toString(),
                tooltip: tssTooltip,
              },
            ]
          : []),
        ...(hrss != null
          ? [
              {
                label: "HRSS",
                value: Math.round(hrss).toString(),
                tooltip: hrSettingsTooltip,
              },
            ]
          : []),
      ]
    : [
        ...(sportConfig.hasPowerMetrics
          ? [
              {
                label: "Intensity Factor",
                value: null,
                tooltip:
                  "Configure your rider settings (FTP) to enable this metric.",
              },
              {
                label: "TSS",
                value: null,
                tooltip: tssSettingsHint,
              },
              {
                label: "HRSS",
                value: null,
                tooltip:
                  "Configure your rider settings (Resting HR, Max HR, LTHR) to enable this metric.",
              },
            ]
          : sportConfig.hasPaceTSS
            ? [
                {
                  label: tssLabel,
                  value: null,
                  tooltip: tssSettingsHint,
                },
              ]
            : []),
      ];

  return (
    <div className="border-border bg-card rounded-xl border p-5">
      <CardTitle className="mb-4">Activity Details</CardTitle>

      {/* Hero Row */}
      <div
        className={cn(
          "border-border mb-4 grid gap-2.5 border-b pb-4",
          heroStats.length >= 4
            ? "grid-cols-2 md:grid-cols-4"
            : heroStats.length === 3
              ? "grid-cols-3"
              : heroStats.length === 2
                ? "grid-cols-2"
                : "grid-cols-1",
        )}
      >
        {heroStats.map((stat) => (
          <StatCard key={stat.label} {...stat} variant="hero" />
        ))}
      </div>

      {/* Grouped Sections */}
      <div className="flex flex-col gap-4">
        <StatSection icon={Clock} title={`Time & ${sportConfig.speedLabel}`}>
          {timeSpeedStats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </StatSection>

        {heartRateStats.length > 0 && (
          <StatSection icon={HeartPulse} title="Heart Rate">
            {heartRateStats.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </StatSection>
        )}

        {powerStats.length > 0 && (
          <StatSection icon={Zap} title="Power">
            {powerStats.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </StatSection>
        )}

        {energyCadenceStats.length > 0 && (
          <StatSection icon={Flame} title="Energy & Cadence">
            {energyCadenceStats.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </StatSection>
        )}

        {trainingLoadStats.length > 0 && (
          <StatSection
            icon={TrendingUp}
            title="Training Load Details"
          >
            {!hasSettings && (
              <SettingsCallout
                hintId="callout-activity-load"
                message={sportConfig.settingsCalloutMessage}
                className="mb-2"
              />
            )}
            {trainingLoadStats.map((stat) => (
              <StatCard
                key={stat.label}
                {...stat}
                settingsLink={!hasSettings ? "/settings/rider" : undefined}
              />
            ))}
          </StatSection>
        )}
      </div>
    </div>
  );
});
