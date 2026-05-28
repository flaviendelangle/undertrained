import * as React from "react";
import type { ReactNode } from "react";

import {
  Activity as ActivityIcon,
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

import type { Activity } from "@server/db/types";

import { CardTitle } from "~/components/primitives/CardTitle";
import { SettingsCallout } from "~/components/primitives/SettingsCallout";
import { StatCard } from "~/components/primitives/StatCard";
import { StatSection } from "~/components/primitives/StatSection";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
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
  const t = useT();
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
      <div className="font-medium">{t("stats.settingsForDate", { date: activityDate })}</div>
      {tssTooltipLines.map((line) => (
        <div key={line.label}>
          {line.label}: {line.value}
        </div>
      ))}
    </div>
  );

  const hrSettingsTooltip = (
    <div className="flex flex-col gap-0.5">
      <div className="font-medium">{t("stats.settingsForDate", { date: activityDate })}</div>
      <div>{t("stats.restingHr")}: {riderSettings.restingHr} bpm</div>
      <div>{t("stats.maxHr")}: {riderSettings.maxHr} bpm</div>
      <div>LTHR: {riderSettings.lthr} bpm</div>
    </div>
  );

  // ── Hero stats ──

  const heroStats: Stat[] = [
    {
      icon: Timer,
      label: t("stats.movingTime"),
      value: formatHumanDuration(activity.movingTime),
    },
    ...(activity.distance > 0
      ? [
          {
            icon: Route,
            label: t("stats.distance"),
            value: sportConfig.formatDistance(activity.distance),
          },
        ]
      : []),
    ...(sportConfig.heroThirdStat === "pace" && activity.averageSpeed > 0
      ? [
          {
            icon: Gauge,
            label: t("stats.avgLabel", { label: sportConfig.speedLabel }),
            value: sportConfig.formatSpeed(activity.averageSpeed),
          },
        ]
      : activity.totalElevationGain > 0
        ? [
            {
              icon: Mountain,
              label: t("stats.elevation"),
              value: `${activity.totalElevationGain} m`,
            },
          ]
        : []),
    ...(() => {
      const loadResult = getActivityLoad(
        activity,
        getLoadPreferences(timeline),
      );
      return loadResult.value != null
        ? [
            {
              icon: TrendingUp,
              label: t("stats.load"),
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
      label: t("stats.elapsedTime"),
      value: formatHumanDuration(activity.elapsedTime),
    },
    ...(activity.averageSpeed > 0
      ? [
          {
            label: t("stats.avgLabel", { label: sportConfig.speedLabel }),
            value: sportConfig.formatSpeed(activity.averageSpeed),
          },
        ]
      : []),
    ...(activity.maxSpeed != null && activity.maxSpeed > 0
      ? [
          {
            label: t("stats.maxLabel", { label: sportConfig.speedLabel }),
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
            label: t("stats.avgHr"),
            value: `${Math.round(activity.averageHeartrate)} bpm`,
          },
        ]
      : []),
    ...(activity.maxHeartrate != null
      ? [
          {
            label: t("stats.maxHr"),
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
            label: t("stats.avgPower"),
            value: `${Math.round(activity.averageWatts)} W`,
          },
        ]
      : []),
    ...(activity.maxWatts != null
      ? [
          {
            label: t("stats.maxPower"),
            value: `${Math.round(activity.maxWatts)} W`,
          },
        ]
      : []),
    ...(np != null
      ? [
          {
            label: t("stats.normalizedPower"),
            value: `${Math.round(np)} W`,
          },
        ]
      : []),
  ];

  // ── Energy & Cadence ──

  const energyCadenceStats: Stat[] = [
    ...(activity.kilojoules != null
      ? [{ label: t("stats.energy"), value: `${Math.round(activity.kilojoules)} kJ` }]
      : []),
    ...(activity.calories != null
      ? [
          {
            label: t("stats.calories"),
            value: `${Math.round(activity.calories)} kcal`,
          },
        ]
      : []),
    ...(activity.averageCadence != null
      ? [
          {
            label: t("stats.avgCadence"),
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
                label: t("stats.intensityFactor"),
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
                label: t("stats.intensityFactor"),
                value: null,
                tooltip: t("stats.ftpSettingsHint"),
              },
              {
                label: "TSS",
                value: null,
                tooltip: tssSettingsHint,
              },
              {
                label: "HRSS",
                value: null,
                tooltip: t("stats.hrSettingsHint"),
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
    <div className="md:border-border md:bg-card p-5 md:rounded-sm md:border">
      <CardTitle className="mb-4">{t("stats.section.activityDetails")}</CardTitle>

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
        <StatSection icon={Clock} title={t("stats.section.timeAndSpeed", { label: sportConfig.speedLabel })}>
          {timeSpeedStats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </StatSection>

        {heartRateStats.length > 0 && (
          <StatSection icon={HeartPulse} title={t("stats.section.heartRate")}>
            {heartRateStats.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </StatSection>
        )}

        {powerStats.length > 0 && (
          <StatSection icon={Zap} title={t("stats.section.power")}>
            {powerStats.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </StatSection>
        )}

        {energyCadenceStats.length > 0 && (
          <StatSection icon={Flame} title={t("stats.section.energyAndCadence")}>
            {energyCadenceStats.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </StatSection>
        )}

        {activity.perceivedExertion != null && (
          <StatSection icon={ActivityIcon} title={t("stats.section.perceivedExertion")}>
            <StatCard
              label="RPE"
              value={`${activity.perceivedExertion} / 10`}
            />
          </StatSection>
        )}

        {trainingLoadStats.length > 0 && (
          <StatSection icon={TrendingUp} title={t("stats.section.trainingLoadDetails")}>
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
