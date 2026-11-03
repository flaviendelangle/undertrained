import * as React from "react";
import type { ReactNode } from "react";

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
import {
  formatHumanDuration,
  formatMeters,
  formatNumber,
} from "~/utils/format";
import { getActivityLoad, getLoadPreferences } from "~/utils/getActivityLoad";
import { getSportConfig } from "~/utils/sportConfig";

interface Stat {
  label: string;
  /** Formatted value; null renders a "--" placeholder. */
  value: string | null;
  tooltip?: ReactNode;
  /** A small mark after the value, such as the zone it falls in. */
  tag?: ReactNode;
}

interface HeroStat {
  id: "moving" | "distance" | "pace" | "elevation" | "calories" | "load";
  label: string;
  value: string;
  tooltip?: ReactNode;
}

const LABEL_CLASS =
  "text-muted-foreground text-xs tracking-wider whitespace-nowrap uppercase";

/** Caption under a bar: muted text with the figures set in the foreground. */
const CAPTION_CLASS =
  "text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs";
const CAPTION_VALUE_CLASS = "text-foreground font-semibold tabular-nums";

/** The shared cool→hot ramp color for a zone (`ramp` indexes it). */
const zoneColor = (ramp: number) => `var(--zone-${ramp + 1})`;

interface ActivityStatsProps {
  activity: Activity;
}

/**
 * The activity's numbers: a headline row, then one panel per metric family the
 * activity actually has. Every panel reads the same way, a row of values and
 * then a bar that gives them context (time in heart-rate zones, power against
 * FTP, RPE on its scale, pauses in the elapsed time), so side-by-side panels
 * line up and a sparse activity stays compact while a rich one fills the card.
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
      label: t("stats.movingTime"),
      value: formatHumanDuration(activity.movingTime),
    },
  ];
  if (activity.distance > 0) {
    hero.push({
      id: "distance",
      label: t("stats.distance"),
      value: sportConfig.formatDistance(activity.distance),
    });
  }
  if (sportConfig.heroThirdStat === "pace" && activity.averageSpeed > 0) {
    hero.push({
      id: "pace",
      label: t("stats.avgLabel", { label: speedLabel }),
      value: sportConfig.formatSpeed(activity.averageSpeed),
    });
  } else if (activity.totalElevationGain > 0) {
    hero.push({
      id: "elevation",
      label: t("stats.elevation"),
      value: formatMeters(activity.totalElevationGain, 1, 0),
    });
  }
  if (hero.length < 3 && activity.calories != null) {
    hero.push({
      id: "calories",
      label: t("stats.calories"),
      value: `${Math.round(activity.calories)} kcal`,
    });
  }
  if (load.value != null) {
    hero.push({
      id: "load",
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
      <StatPanel key="hr" title={t("stats.section.heartRate")}>
        <MetricRow>
          {avgHr != null && (
            <Metric
              label={t("stats.average")}
              value={`${Math.round(avgHr)} bpm`}
              tag={
                avgZone && (
                  <ZoneTag ramp={avgZone.zone.ramp}>
                    Z{avgZone.index + 1}
                  </ZoneTag>
                )
              }
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
      <StatPanel key="power" title={t("stats.section.power")}>
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
          {intensityFactor != null && (
            <Metric
              label="IF"
              value={formatNumber(intensityFactor, 2)}
              tooltip={tssTooltip}
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
  const showLoadStats = loadStats.length > 0 && !loadRepeatsHeadline;
  if (rpe != null || showLoadStats) {
    panels.push(
      <StatPanel key="effort" title={t("stats.section.effort")}>
        <MetricRow>
          {rpe != null && (
            <Metric
              label={t("stats.section.perceivedExertion")}
              value={String(rpe)}
              unit="/ 10"
            />
          )}
          {showLoadStats &&
            loadStats.map((stat) => (
              <Metric
                key={stat.label}
                {...stat}
                settingsLink={hasSettings ? undefined : "/settings/rider"}
              />
            ))}
        </MetricRow>
        {rpe != null && <RpeMeter rpe={rpe} />}
        {!hasSettings && showLoadStats && (
          <SettingsCallout
            hintId="callout-activity-load"
            message={sportConfig.settingsCalloutMessage}
          />
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
      title={
        speedStats.length > 0
          ? t("stats.section.timeAndSpeed", { label: speedLabel })
          : t("stats.section.time")
      }
    >
      <MetricRow>
        <Metric
          label={t("stats.elapsedTime")}
          value={formatHumanDuration(activity.elapsedTime)}
        />
        {speedStats.map((stat) => (
          <Metric key={stat.label} {...stat} />
        ))}
      </MetricRow>
      <PauseBar
        moving={activity.movingTime}
        paused={paused}
        color={sportConfig.color}
      />
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
      <StatPanel key="energy" title={t("stats.section.energyAndCadence")}>
        <MetricRow>
          {energyStats.map((stat) => (
            <Metric key={stat.label} {...stat} />
          ))}
        </MetricRow>
      </StatPanel>,
    );
  }

  return (
    <div className="md:border-border md:bg-card px-5 pt-5 pb-1 md:rounded-sm md:border">
      <CardTitle className="mb-5">
        {t("stats.section.activityDetails")}
      </CardTitle>

      <div
        className={cn(
          "grid grid-cols-2 gap-4 pb-5 md:gap-0 md:divide-x",
          HERO_COLUMNS[hero.length],
        )}
      >
        {hero.map((stat) => (
          <div key={stat.id} className="min-w-0 md:px-6 md:first:pl-0">
            <WithTooltip tooltip={stat.tooltip}>
              <div className="w-fit">
                <div className={LABEL_CLASS}>{stat.label}</div>
                <div className="mt-1.5 text-2xl leading-none font-semibold tracking-tight tabular-nums md:text-[1.75rem]">
                  <Quantity text={stat.value} />
                </div>
              </div>
            </WithTooltip>
          </div>
        ))}
      </div>

      {/* Hairlines, not boxes, delimit the panels: each row rules itself off
          from the one above and the two columns share one vertical rule, the
          same way the headline stats are divided. An odd last panel spans both
          columns instead of leaving a hole. */}
      <div className="grid md:grid-cols-2">{panels}</div>
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
              "text-muted-foreground text-[0.6em] font-medium tracking-normal",
              /^\s/.test(part) ? "ml-1" : "ml-0.5",
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
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border flex flex-col gap-4 border-t py-4 md:odd:border-r md:odd:pr-6 md:odd:last:col-span-2 md:odd:last:border-r-0 md:odd:last:pr-0 md:even:pl-6">
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </section>
  );
}

function MetricRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-x-7 gap-y-3">{children}</div>;
}

function Metric({
  label,
  value,
  unit,
  tooltip,
  tag,
  settingsLink,
}: Stat & { unit?: string; settingsLink?: string }) {
  const t = useT();
  return (
    <WithTooltip tooltip={tooltip}>
      <div className="min-w-0">
        <div className={LABEL_CLASS}>{label}</div>
        <div className="mt-1 text-xl leading-tight font-semibold whitespace-nowrap tabular-nums">
          {value != null ? (
            <>
              <Quantity text={value} unit={unit} />
              {tag}
            </>
          ) : (
            <span className="text-muted-foreground">
              --
              {settingsLink && (
                <Link
                  href={settingsLink}
                  className="text-primary block text-xs font-medium hover:underline"
                >
                  {t("common.openSettings")}
                </Link>
              )}
            </span>
          )}
        </div>
      </div>
    </WithTooltip>
  );
}

/** A zone code with its swatch, the same mark the zone legend uses. */
function ZoneTag({ ramp, children }: { ramp: number; children: ReactNode }) {
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-[0.2em] text-xs font-semibold">
      <span
        className="size-2 rounded-[2px]"
        style={{ backgroundColor: zoneColor(ramp) }}
      />
      {children}
    </span>
  );
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
    <div>
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
      <div className={cn(CAPTION_CLASS, "mt-1")}>
        {zones.map((zone) => (
          <span
            key={zone.code}
            className={cn(
              "inline-flex items-center gap-1.5",
              zone.seconds === 0 && "opacity-50",
            )}
          >
            <span
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: zoneColor(zone.ramp) }}
            />
            {zone.code}
            <span className={CAPTION_VALUE_CLASS}>
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
    <div>
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
                    "font-semibold tabular-nums",
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
      <div className="text-muted-foreground relative mt-1 h-4 text-xs">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums"
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
    <div className="flex gap-0.5" aria-hidden>
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
 * Elapsed time split into moving time (in the sport's color) and pauses; a
 * full bar when the activity never stopped.
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
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        <span style={{ flex: `${moving} 0 0`, backgroundColor: color }} />
        {paused > 0 && (
          <span
            className="bg-muted-foreground/40"
            // Keep short pauses visible next to a long moving time.
            style={{ flex: `${Math.max(paused, elapsed * 0.015)} 0 0` }}
          />
        )}
      </div>
      <div className={cn(CAPTION_CLASS, "mt-1")}>
        {paused > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-muted-foreground/40 size-2 rounded-[2px]" />
            {t("stats.paused")}
            <span className={CAPTION_VALUE_CLASS}>
              {formatHumanDuration(paused)}
            </span>
          </span>
        ) : (
          <span>{t("stats.noPause")}</span>
        )}
      </div>
    </div>
  );
}
