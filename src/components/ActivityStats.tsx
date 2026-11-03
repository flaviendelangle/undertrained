import * as React from "react";
import type { ReactNode } from "react";

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
import Link from "next/link";

import type { Activity } from "@server/db/types";

import { placeTrackLabels } from "~/components/powerTrackLabels";
import { CardTitle } from "~/components/primitives/CardTitle";
import { SettingsCallout } from "~/components/primitives/SettingsCallout";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
import { activitySettingsDay } from "~/lib/activityRecording";
import { cn } from "~/lib/utils";
import { POWER_ZONES } from "~/sensors/types";
import { ZONE_MODELS } from "~/sensors/zoneModels";
import { formatHumanDuration, formatMeters } from "~/utils/format";
import { getActivityLoad, getLoadPreferences } from "~/utils/getActivityLoad";
import { getSportConfig } from "~/utils/sportConfig";

interface Stat {
  label: string;
  /** Formatted value; null renders a "--" placeholder. */
  value: string | null;
  tooltip?: ReactNode;
}

interface HeroStat {
  id: "moving" | "distance" | "pace" | "elevation" | "calories" | "load";
  icon: LucideIcon;
  label: string;
  value: string;
  tooltip?: ReactNode;
}

const LABEL_CLASS =
  "text-muted-foreground flex items-center gap-1.5 text-xs tracking-wider whitespace-nowrap uppercase";

/** The shared cool→hot ramp color for a zone (`ramp` indexes it). */
const zoneColor = (ramp: number) => `var(--zone-${ramp + 1})`;

interface ActivityStatsProps {
  activity: Activity;
}

/**
 * The activity's numbers: a headline row, then one panel per metric family the
 * activity actually has. Panels give the values context (time in heart-rate
 * zones, power against FTP, RPE on its scale) and sit in two aligned columns,
 * so a sparse activity stays compact and a rich one fills the card.
 */
export const ActivityStats = React.memo(function ActivityStats({
  activity,
}: ActivityStatsProps) {
  const t = useT();
  const sportConfig = getSportConfig(activity.type);
  const { resolveForDate, hasSettings, timeline } = useRiderSettingsTimeline();
  const activityDate = activitySettingsDay(activity);
  const riderSettings = resolveForDate(activityDate);

  const np = activity.weightedAverageWatts ?? null;
  const ftp = riderSettings.ftp;
  const intensityFactor =
    hasSettings && ftp > 0 && sportConfig.hasPowerMetrics && np != null
      ? np / ftp
      : null;
  const tss =
    sportConfig.hasPowerMetrics || sportConfig.hasPaceTSS
      ? (activity.tss ?? null)
      : null;
  const hrss = activity.hrss ?? null;
  const load = getActivityLoad(activity, getLoadPreferences(timeline));
  const speedLabel = t(sportConfig.speedLabelKey);

  const tssTooltipLines = sportConfig.getTssTooltipLines(riderSettings, np);
  const tssTooltip = (
    <div className="flex flex-col gap-0.5">
      <div className="font-medium">
        {t("stats.settingsForDate", { date: activityDate })}
      </div>
      {tssTooltipLines.map((line) => (
        <div key={line.label}>
          {line.label}: {line.value}
        </div>
      ))}
    </div>
  );

  const hrSettingsTooltip = (
    <div className="flex flex-col gap-0.5">
      <div className="font-medium">
        {t("stats.settingsForDate", { date: activityDate })}
      </div>
      <div>
        {t("stats.restingHr")}: {riderSettings.restingHr} bpm
      </div>
      <div>
        {t("stats.maxHr")}: {riderSettings.maxHr} bpm
      </div>
      <div>LTHR: {riderSettings.lthr} bpm</div>
    </div>
  );

  // ── Headline ──
  // Moving time, distance and the sport's third stat; calories fill in when
  // that leaves the row short (strength, indoor). Load always closes the row.
  // The panels below never repeat a headline metric.

  const hero: HeroStat[] = [
    {
      id: "moving",
      icon: Timer,
      label: t("stats.movingTime"),
      value: formatHumanDuration(activity.movingTime),
    },
  ];
  if (activity.distance > 0) {
    hero.push({
      id: "distance",
      icon: Route,
      label: t("stats.distance"),
      value: sportConfig.formatDistance(activity.distance),
    });
  }
  if (sportConfig.heroThirdStat === "pace" && activity.averageSpeed > 0) {
    hero.push({
      id: "pace",
      icon: Gauge,
      label: t("stats.avgLabel", { label: speedLabel }),
      value: sportConfig.formatSpeed(activity.averageSpeed),
    });
  } else if (activity.totalElevationGain > 0) {
    hero.push({
      id: "elevation",
      icon: Mountain,
      label: t("stats.elevation"),
      value: formatMeters(activity.totalElevationGain, 1, 0),
    });
  }
  if (hero.length < 3 && activity.calories != null) {
    hero.push({
      id: "calories",
      icon: Flame,
      label: t("stats.calories"),
      value: `${Math.round(activity.calories)} kcal`,
    });
  }
  if (load.value != null) {
    hero.push({
      id: "load",
      icon: TrendingUp,
      label: t("stats.load"),
      value: Math.round(load.value).toString(),
      tooltip: load.tooltip,
    });
  }
  const inHero = new Set(hero.map((stat) => stat.id));

  const panels: ReactNode[] = [];

  // ── Heart rate ──

  const avgHr = activity.averageHeartrate;
  const maxHr = activity.maxHeartrate;
  if (avgHr != null || maxHr != null) {
    const avgZone =
      avgHr != null &&
      hasSettings &&
      riderSettings.maxHr > riderSettings.restingHr
        ? ZONE_MODELS.hr.classify(avgHr, riderSettings)
        : null;
    panels.push(
      <StatPanel
        key="hr"
        icon={HeartPulse}
        title={t("stats.section.heartRate")}
        aside={
          avgZone && (
            <ZoneChip ramp={avgZone.zone.ramp}>
              {t("stats.avgInZone", { zone: `Z${avgZone.index + 1}` })}
            </ZoneChip>
          )
        }
      >
        <MetricRow>
          {avgHr != null && (
            <Metric
              label={t("stats.average")}
              value={`${Math.round(avgHr)} bpm`}
            />
          )}
          {maxHr != null && (
            <Metric
              label={t("stats.maximum")}
              value={`${Math.round(maxHr)} bpm`}
            />
          )}
        </MetricRow>
        {activity.zoneSeconds?.hr && (
          <HeartRateZoneBar rampSeconds={activity.zoneSeconds.hr} />
        )}
      </StatPanel>,
    );
  }

  // ── Power ──

  const avgWatts = activity.averageWatts;
  if (avgWatts != null || np != null || activity.maxWatts != null) {
    // FTP and its zones are cycling thresholds: a running power meter's watts
    // have nothing to be placed against.
    const showTrack =
      sportConfig.hasPowerMetrics &&
      hasSettings &&
      ftp > 0 &&
      (np != null || avgWatts != null);
    panels.push(
      <StatPanel
        key="power"
        icon={Zap}
        title={t("stats.section.power")}
        aside={
          intensityFactor != null && (
            <WithTooltip tooltip={tssTooltip}>
              <span className="flex">
                <Chip color="var(--chart-8)">
                  IF {intensityFactor.toFixed(2)}
                </Chip>
              </span>
            </WithTooltip>
          )
        }
      >
        <MetricRow>
          {avgWatts != null && (
            <Metric
              label={t("stats.average")}
              value={`${Math.round(avgWatts)} W`}
            />
          )}
          {np != null && (
            <Metric
              label={t("stats.normalized")}
              value={`${Math.round(np)} W`}
              tooltip={t("stats.normalizedPowerTooltip")}
            />
          )}
          {activity.maxWatts != null && (
            <Metric
              label={t("stats.maximum")}
              value={`${Math.round(activity.maxWatts)} W`}
            />
          )}
        </MetricRow>
        {showTrack && (
          <PowerTrack average={avgWatts} normalized={np} ftp={ftp} />
        )}
      </StatPanel>,
    );
  }

  // ── Effort: perceived exertion, and the scores behind the load ──

  const rpe = activity.perceivedExertion;
  const loadStats: Stat[] = hasSettings
    ? [
        ...(tss != null
          ? [
              {
                label: sportConfig.tssLabel,
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
    : sportConfig.hasPowerMetrics
      ? [
          {
            label: "IF",
            value: null,
            tooltip: t("stats.ftpSettingsHint"),
          },
          { label: "TSS", value: null, tooltip: sportConfig.tssSettingsHint },
          { label: "HRSS", value: null, tooltip: t("stats.hrSettingsHint") },
        ]
      : sportConfig.hasPaceTSS
        ? [
            {
              label: sportConfig.tssLabel,
              value: null,
              tooltip: sportConfig.tssSettingsHint,
            },
          ]
        : [];
  // A single score that is the headline load says nothing new.
  const loadRepeatsHeadline =
    hasSettings &&
    loadStats.length === 1 &&
    load.value != null &&
    loadStats[0].value === Math.round(load.value).toString();
  if (rpe != null || (loadStats.length > 0 && !loadRepeatsHeadline)) {
    panels.push(
      <StatPanel
        key="effort"
        icon={TrendingUp}
        title={t("stats.section.effort")}
      >
        {rpe != null && (
          <div>
            <div className={LABEL_CLASS}>
              {t("stats.section.perceivedExertion")}
            </div>
            <div className="mt-1 flex items-center gap-3">
              <div className="font-mono text-xl font-bold whitespace-nowrap tabular-nums">
                <Quantity text={String(rpe)} unit="/ 10" />
              </div>
              <RpeMeter rpe={rpe} />
            </div>
          </div>
        )}
        {!hasSettings && loadStats.length > 0 && (
          <SettingsCallout
            hintId="callout-activity-load"
            message={sportConfig.settingsCalloutMessage}
            className={cn("mb-3", rpe != null && "mt-4")}
          />
        )}
        {loadStats.length > 0 && !loadRepeatsHeadline && (
          <MetricRow className={cn(rpe != null && hasSettings && "mt-4")}>
            {loadStats.map((stat) => (
              <Metric
                key={stat.label}
                {...stat}
                settingsLink={hasSettings ? undefined : "/settings/rider"}
              />
            ))}
          </MetricRow>
        )}
      </StatPanel>,
    );
  }

  // ── Time & speed ──

  const paused = Math.max(0, activity.elapsedTime - activity.movingTime);
  const speedStats: Stat[] = [
    ...(activity.averageSpeed > 0 && !inHero.has("pace")
      ? [
          {
            label: t("stats.avgLabel", { label: speedLabel }),
            value: sportConfig.formatSpeed(activity.averageSpeed),
          },
        ]
      : []),
    ...(activity.maxSpeed != null && activity.maxSpeed > 0
      ? [
          {
            label: t("stats.maxLabel", { label: speedLabel }),
            value: sportConfig.formatSpeed(activity.maxSpeed),
          },
        ]
      : []),
    ...(activity.totalElevationGain > 0 && !inHero.has("elevation")
      ? [
          {
            label: t("stats.elevation"),
            value: formatMeters(activity.totalElevationGain, 1, 0),
          },
        ]
      : []),
  ];
  panels.push(
    <StatPanel
      key="time"
      icon={Clock}
      title={
        speedStats.length > 0
          ? t("stats.section.timeAndSpeed", { label: speedLabel })
          : t("stats.section.time")
      }
    >
      <PauseBar
        moving={activity.movingTime}
        paused={paused}
        color={sportConfig.color}
      />
      {speedStats.length > 0 && (
        <MetricRow className="mt-4">
          {speedStats.map((stat) => (
            <Metric key={stat.label} {...stat} />
          ))}
        </MetricRow>
      )}
    </StatPanel>,
  );

  // ── Energy & cadence ──

  const energyStats: Stat[] = [
    ...(activity.kilojoules != null
      ? [
          {
            label: t("stats.energy"),
            value: `${Math.round(activity.kilojoules)} kJ`,
          },
        ]
      : []),
    ...(activity.calories != null && !inHero.has("calories")
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
  if (energyStats.length > 0) {
    panels.push(
      <StatPanel
        key="energy"
        icon={Flame}
        title={t("stats.section.energyAndCadence")}
      >
        <MetricRow>
          {energyStats.map((stat) => (
            <Metric key={stat.label} {...stat} />
          ))}
        </MetricRow>
      </StatPanel>,
    );
  }

  return (
    <div className="md:border-border md:bg-card p-5 md:rounded-sm md:border">
      <CardTitle className="mb-4">
        {t("stats.section.activityDetails")}
      </CardTitle>

      <div
        className={cn(
          "grid grid-cols-2 gap-4 md:gap-x-0 md:divide-x",
          HERO_COLUMNS[hero.length],
        )}
      >
        {hero.map((stat) => (
          <div key={stat.id} className="min-w-0 md:px-5 md:first:pl-0">
            <WithTooltip tooltip={stat.tooltip}>
              <div className="w-fit">
                <div className={LABEL_CLASS}>
                  <stat.icon className="size-3.5 shrink-0" />
                  {stat.label}
                </div>
                <div className="mt-1.5 font-mono text-2xl leading-tight font-bold tabular-nums md:text-[1.75rem]">
                  <Quantity text={stat.value} />
                </div>
              </div>
            </WithTooltip>
          </div>
        ))}
      </div>

      {panels.length > 0 && (
        // Rows keep the two columns aligned: panels side by side share one
        // height, and an odd last panel spans both columns instead of leaving
        // a hole.
        <div className="mt-5 grid gap-3 md:grid-cols-2">{panels}</div>
      )}
    </div>
  );
});

const HERO_COLUMNS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

function WithTooltip({
  tooltip,
  children,
}: {
  tooltip?: ReactNode;
  children: React.ReactElement;
}) {
  if (!tooltip) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A formatted value with its units set smaller and muted, so the digits carry
 * the weight: "2h 31m 40s", "72.4 km", "5:08 /km". `unit` appends one more.
 */
function Quantity({ text, unit }: { text: string; unit?: string }) {
  // Split keeps the numbers (odd indexes) between the unit runs around them.
  const parts = text.split(/(\d(?:[\d.,:\u00a0\u202f]*\d)?)/);
  if (unit != null) parts[parts.length - 1] += ` ${unit}`;
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 1)
          return <React.Fragment key={index}>{part}</React.Fragment>;
        const trimmed = part.trim();
        if (trimmed === "") return null;
        return (
          <span
            key={index}
            className={cn(
              "text-muted-foreground font-sans text-[0.6em] font-medium tracking-normal",
              /^\s/.test(part) ? "ml-1" : "ml-px",
              /\s$/.test(part) && index < parts.length - 1 && "mr-1.5",
            )}
          >
            {trimmed}
          </span>
        );
      })}
    </>
  );
}

function StatPanel({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: LucideIcon;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-border bg-background/30 rounded-md border p-4 md:odd:last:col-span-2">
      <div className="mb-3 flex min-h-5 items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="text-muted-foreground size-4 shrink-0" />
          {title}
        </h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

function MetricRow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap gap-x-6 gap-y-3", className)}>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  tooltip,
  settingsLink,
}: Stat & { settingsLink?: string }) {
  return (
    <WithTooltip tooltip={tooltip}>
      <div className="min-w-0">
        <div className={LABEL_CLASS}>{label}</div>
        <div className="mt-1 font-mono text-xl font-bold whitespace-nowrap tabular-nums">
          {value != null ? (
            <Quantity text={value} />
          ) : (
            <span>
              --
              {settingsLink && (
                <Link
                  href={settingsLink}
                  className="text-primary block font-sans text-[10px] font-medium hover:underline"
                >
                  Configure
                </Link>
              )}
            </span>
          )}
        </div>
      </div>
    </WithTooltip>
  );
}

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={{
        color,
        backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

function ZoneChip({ ramp, children }: { ramp: number; children: ReactNode }) {
  return <Chip color={zoneColor(ramp)}>{children}</Chip>;
}

/** Share of the activity spent in each heart-rate zone, as one stacked bar. */
function HeartRateZoneBar({ rampSeconds }: { rampSeconds: readonly number[] }) {
  const t = useT();
  const zones = ZONE_MODELS.hr.zones.map((zone, index) => ({
    code: `Z${index + 1}`,
    ramp: zone.ramp,
    seconds: rampSeconds[zone.ramp] ?? 0,
  }));
  const total = zones.reduce((sum, zone) => sum + zone.seconds, 0);
  if (total <= 0) return null;

  return (
    <div className="mt-4">
      <div className={LABEL_CLASS}>{t("stats.timeInZones")}</div>
      {/* Same geometry as PowerTrack, so the two bars line up side by side. */}
      <div className="relative mt-1 h-5">
        <div className="absolute inset-x-0 top-1.5 flex h-2 gap-0.5 overflow-hidden rounded-full">
          {zones.map(
            (zone) =>
              zone.seconds > 0 && (
                <span
                  key={zone.code}
                  className="min-w-1"
                  style={{
                    flex: `${zone.seconds} 0 0`,
                    backgroundColor: zoneColor(zone.ramp),
                  }}
                />
              ),
          )}
        </div>
      </div>
      <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs sm:gap-x-3">
        {zones.map((zone) => (
          <span
            key={zone.code}
            className={cn(
              "inline-flex items-center gap-1 sm:gap-1.5",
              zone.seconds === 0 && "opacity-50",
            )}
          >
            <span
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: zoneColor(zone.ramp) }}
            />
            {zone.code}
            <span className="text-foreground font-semibold tabular-nums">
              {Math.round((zone.seconds / total) * 100)} %
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** How far the track reaches, as a multiple of FTP. */
const POWER_TRACK_SCALE = 1.5;

/**
 * Variability index (NP ÷ average power) from which the power track marks
 * average next to NP. Below it the effort was steady enough that the two marks
 * would sit on top of each other.
 */
const TRACK_AVERAGE_FROM_VARIABILITY = 1.1;

interface TrackMark {
  label: string;
  watts: number;
  /** Where the label sits relative to its mark. */
  side: "before" | "center" | "after";
  muted?: boolean;
}

/**
 * Normalized power placed on the rider's power zones up to 150% of FTP, with
 * average power next to it when the effort was variable (or alone without
 * NP). Labels sit above the track and FTP's below, so they never collide: with
 * two marks, average (always the lower one) is labelled on its left and NP on
 * its right, or the two share one caption near either end of the track.
 */
function PowerTrack({
  average,
  normalized,
  ftp,
}: {
  average: number | null;
  normalized: number | null;
  ftp: number;
}) {
  const t = useT();
  const ratio = (value: number) =>
    Math.min(1, value / (ftp * POWER_TRACK_SCALE));
  const position = (value: number) => `${ratio(value) * 100}%`;
  const bands: { ramp: number; width: number }[] = [];
  let lower = 0;
  for (const zone of POWER_ZONES) {
    if (lower >= POWER_TRACK_SCALE) break;
    const upper = Math.min(zone.maxPct, POWER_TRACK_SCALE);
    bands.push({ ramp: zone.ramp, width: upper - lower });
    lower = upper;
  }

  const both =
    normalized != null &&
    average != null &&
    normalized >= average * TRACK_AVERAGE_FROM_VARIABILITY;
  const marks: TrackMark[] = [];
  if (average != null && (normalized == null || both)) {
    marks.push({
      label: t("stats.average"),
      watts: average,
      side: both ? "before" : "center",
      muted: both,
    });
  }
  if (normalized != null) {
    marks.push({
      label: "NP",
      watts: normalized,
      side: both ? "after" : "center",
    });
  }

  const labelGroups = placeTrackLabels(
    marks.map((mark) => ({ ...mark, at: ratio(mark.watts) })),
  );

  return (
    // Label row, track and caption mirror HeartRateZoneBar's geometry, so the
    // two bars line up when the panels sit side by side.
    <div className="mt-4">
      <div className="relative h-4 text-xs">
        {labelGroups.map((group) => (
          <span
            key={group.labels[0].label}
            className={cn(
              "absolute flex gap-3 whitespace-nowrap",
              group.anchor,
            )}
            style={{ left: `${group.at * 100}%` }}
          >
            {group.labels.map((mark) => (
              <span key={mark.label}>
                <span className="text-muted-foreground tracking-wider uppercase">
                  {mark.label}
                </span>{" "}
                <span
                  className={cn(
                    "font-mono font-semibold",
                    mark.muted && "text-muted-foreground",
                  )}
                >
                  {Math.round(mark.watts)} W
                </span>
              </span>
            ))}
          </span>
        ))}
      </div>
      <div className="relative mt-1 h-5" aria-hidden>
        <div className="absolute inset-x-0 top-1.5 flex h-2 overflow-hidden rounded-full">
          {bands.map((band) => (
            <span
              key={band.ramp}
              style={{
                flex: `${band.width} 0 0`,
                backgroundColor: `color-mix(in oklab, ${zoneColor(band.ramp)} 45%, transparent)`,
              }}
            />
          ))}
        </div>
        <span
          className="bg-muted-foreground absolute inset-y-0 w-px"
          style={{ left: position(ftp) }}
        />
        {marks.map((mark) => (
          <span
            key={mark.label}
            className={cn(
              "absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full",
              mark.muted ? "bg-foreground/50" : "bg-foreground",
            )}
            style={{ left: position(mark.watts) }}
          />
        ))}
      </div>
      <div className="text-muted-foreground relative mt-1 h-4 text-[11px]">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: position(ftp) }}
        >
          FTP {ftp} W
        </span>
      </div>
    </div>
  );
}

/** RPE on its 1–10 scale, the filled steps warming along the zone ramp. */
function RpeMeter({ rpe }: { rpe: number }) {
  const filled = Math.round(rpe);
  return (
    <div className="flex flex-1 gap-0.5" aria-hidden>
      {Array.from({ length: 10 }, (_, step) => (
        <span
          key={step}
          className="bg-foreground/10 h-2 flex-1 rounded-[2px]"
          style={
            step < filled
              ? { backgroundColor: zoneColor(RPE_STEP_RAMP[step]) }
              : undefined
          }
        />
      ))}
    </div>
  );
}

/** Zone-ramp index for each RPE step: easy steps cool, maximal ones hot. */
const RPE_STEP_RAMP = [1, 1, 1, 2, 2, 3, 3, 4, 4, 5];

/**
 * Elapsed time split into moving time and pauses; a full bar when the
 * activity never stopped.
 */
function PauseBar({
  moving,
  paused,
  color,
}: {
  moving: number;
  paused: number;
  color: string;
}) {
  const t = useT();
  const elapsed = moving + paused;
  return (
    <div>
      <div className="text-muted-foreground flex flex-wrap justify-between gap-x-4 text-xs">
        <span>
          {t("stats.elapsedTime")}{" "}
          <span className="text-foreground font-mono font-semibold">
            {formatHumanDuration(elapsed)}
          </span>
        </span>
        {paused > 0 ? (
          <span>
            {t("stats.paused")}{" "}
            <span className="text-foreground font-mono font-semibold">
              {formatHumanDuration(paused)}
            </span>
          </span>
        ) : (
          <span>{t("stats.noPause")}</span>
        )}
      </div>
      {/* As tall as the RPE row, so the bar lines up with the RPE scale when
          the two panels sit side by side. */}
      <div className="mt-1 flex h-7 items-center">
        <div className="flex h-2 flex-1 gap-0.5 overflow-hidden rounded-full">
          <span style={{ flex: `${moving} 0 0`, backgroundColor: color }} />
          {paused > 0 && (
            <span
              className="bg-[repeating-linear-gradient(135deg,var(--muted-foreground)_0_2px,transparent_2px_5px)] opacity-70"
              // Keep short pauses visible next to a long moving time.
              style={{ flex: `${Math.max(paused, elapsed * 0.015)} 0 0` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
