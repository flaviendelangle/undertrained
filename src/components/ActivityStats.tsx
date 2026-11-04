import * as React from "react";
import type { ReactNode } from "react";

import Link from "next/link";

import type { Activity } from "@server/db/types";

import { placeTrackLabels } from "~/components/powerTrackLabels";
import { CardTitle } from "~/components/primitives/CardTitle";
import { Quantity } from "~/components/primitives/Quantity";
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
  /**
   * The value, formatted (units included or in `unit`); null renders a "--"
   * placeholder linking to the rider settings.
   */
  value: string | null;
  unit?: string;
  tooltip?: ReactNode;
  /** A small mark after the value, such as the zone it falls in. */
  tag?: ReactNode;
}

const LABEL_CLASS =
  "text-muted-foreground text-xs tracking-wider whitespace-nowrap uppercase";

/** Caption under a bar: muted text with the figures set in the foreground. */
const CAPTION_CLASS =
  "text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs";

/**
 * The zone and power bars: a row tall enough for the marks that overhang the
 * bar, and the bar inside it. Sharing both keeps those bars level when their
 * panels sit side by side.
 */
const RAIL_CLASS = "relative mt-1 h-5";
const BAR_CLASS =
  "absolute inset-x-0 top-1.5 flex h-2 overflow-hidden rounded-full";

/** The shared cool→hot ramp color for a zone (`ramp` indexes it). */
const zoneColor = (ramp: number) => `var(--zone-${ramp + 1})`;

const PAUSE_COLOR =
  "color-mix(in oklab, var(--muted-foreground) 40%, transparent)";

interface ActivityStatsProps {
  activity: Activity;
}

/**
 * The activity's numbers: a headline row, then one panel per metric family the
 * activity actually has. A panel shows its values, then the bar that gives
 * them context when there is one (time in heart-rate zones, power against FTP,
 * RPE on its scale, pauses in the elapsed time), so side-by-side panels line
 * up and a sparse activity stays compact while a rich one fills the card.
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
  // FTP and its zones are cycling thresholds: a running power meter's watts
  // have nothing to be placed against.
  const ftp =
    hasSettings && sportConfig.hasPowerMetrics
      ? ZONE_MODELS.power.threshold(riderSettings)
      : null;
  const intensityFactor = ftp != null && np != null ? np / ftp : null;
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

  // Stats that go in the headline when they fit and in a panel otherwise.
  const pace: Stat | null =
    activity.averageSpeed > 0
      ? {
          label: t("stats.avgLabel", { label: speedLabel }),
          value: sportConfig.formatSpeed(activity.averageSpeed),
        }
      : null;
  const elevation: Stat | null =
    activity.totalElevationGain > 0
      ? {
          label: t("stats.elevation"),
          value: formatMeters(activity.totalElevationGain, 1, 0),
        }
      : null;
  const calories: Stat | null =
    activity.calories != null
      ? {
          label: t("stats.calories"),
          value: String(Math.round(activity.calories)),
          unit: "kcal",
        }
      : null;

  // ── Headline ──
  // Moving time, distance and the sport's third stat; calories fill in when
  // that leaves the row short (strength, indoor). Load always closes the row.
  // The panels below never repeat a headline stat.

  const headline: Stat[] = [
    {
      label: t("stats.movingTime"),
      value: formatHumanDuration(activity.movingTime),
    },
  ];
  if (activity.distance > 0) {
    headline.push({
      label: t("stats.distance"),
      value: sportConfig.formatDistance(activity.distance),
    });
  }
  const third = (sportConfig.heroThirdStat === "pace" && pace) || elevation;
  if (third) headline.push(third);
  if (headline.length < 3 && calories) headline.push(calories);
  if (load.value != null) {
    headline.push({
      label: t("stats.load"),
      value: Math.round(load.value).toString(),
      tooltip: load.tooltip,
    });
  }
  const inPanel = (stat: Stat | null): stat is Stat =>
    stat != null && !headline.includes(stat);

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
              value={String(Math.round(avgHr))}
              unit="bpm"
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
              value={String(Math.round(maxHr))}
              unit="bpm"
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
    panels.push(
      <StatPanel key="power" title={t("stats.section.power")}>
        <MetricRow>
          {avgWatts != null && (
            <Metric
              label={t("stats.average")}
              value={String(Math.round(avgWatts))}
              unit="W"
            />
          )}
          {np != null && (
            <Metric
              label={t("stats.normalized")}
              value={String(Math.round(np))}
              unit="W"
              tooltip={t("stats.normalizedPowerTooltip")}
            />
          )}
          {activity.maxWatts != null && (
            <Metric
              label={t("stats.maximum")}
              value={String(Math.round(activity.maxWatts))}
              unit="W"
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
        {ftp != null && (np != null || avgWatts != null) && (
          <PowerTrack average={avgWatts} normalized={np} ftp={ftp} />
        )}
      </StatPanel>,
    );
  }

  // ── Effort: perceived exertion, and the scores behind the load ──

  const rpe = activity.perceivedExertion;
  const loadStats: Stat[] = [];
  if (hasSettings) {
    if (tss != null) {
      loadStats.push({
        label: sportConfig.tssLabel,
        value: Math.round(tss).toString(),
        tooltip: tssTooltip,
      });
    }
    if (hrss != null) {
      loadStats.push({
        label: "HRSS",
        value: Math.round(hrss).toString(),
        tooltip: hrSettingsTooltip,
      });
    }
  } else if (sportConfig.hasPowerMetrics) {
    loadStats.push(
      { label: "IF", value: null, tooltip: t("stats.ftpSettingsHint") },
      { label: "TSS", value: null, tooltip: sportConfig.tssSettingsHint },
      { label: "HRSS", value: null, tooltip: t("stats.hrSettingsHint") },
    );
  } else if (sportConfig.hasPaceTSS) {
    loadStats.push({
      label: sportConfig.tssLabel,
      value: null,
      tooltip: sportConfig.tssSettingsHint,
    });
  }
  // A lone score that is the one the headline load comes from says nothing
  // new.
  const loadRepeatsHeadline =
    hasSettings && loadStats.length === 1 && loadStats[0].label === load.label;
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
            loadStats.map((stat) => <Metric key={stat.label} {...stat} />)}
        </MetricRow>
        {rpe != null && <RpeMeter rpe={rpe} />}
        {!hasSettings && showLoadStats && (
          <SettingsCallout message={sportConfig.settingsCalloutMessage} />
        )}
      </StatPanel>,
    );
  }

  // ── Time & speed ──

  const speedStats: Stat[] = [];
  if (inPanel(pace)) speedStats.push(pace);
  if (activity.maxSpeed != null && activity.maxSpeed > 0) {
    speedStats.push({
      label: t("stats.maxLabel", { label: speedLabel }),
      value: sportConfig.formatSpeed(activity.maxSpeed),
    });
  }
  if (inPanel(elevation)) speedStats.push(elevation);
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
        elapsed={activity.elapsedTime}
        color={sportConfig.color}
      />
    </StatPanel>,
  );

  // ── Energy & cadence ──

  const energyStats: Stat[] = [];
  if (activity.kilojoules != null) {
    energyStats.push({
      label: t("stats.energy"),
      value: String(Math.round(activity.kilojoules)),
      unit: "kJ",
    });
  }
  if (inPanel(calories)) energyStats.push(calories);
  if (activity.averageCadence != null) {
    energyStats.push({
      label: t("stats.avgCadence"),
      value: String(Math.round(activity.averageCadence)),
      unit: sportConfig.cadenceUnit,
    });
  }
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
          HEADLINE_COLUMNS[headline.length],
        )}
      >
        {headline.map((stat) => (
          <div key={stat.label} className="min-w-0 md:px-6 md:first:pl-0">
            <Metric {...stat} size="headline" />
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2">{panels}</div>
    </div>
  );
});

const HEADLINE_COLUMNS: Record<number, string> = {
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
 * Hairlines delimit the panels: each row rules itself off from the one above
 * and the two columns share one vertical rule, like the headline's dividers.
 * An odd last panel spans both columns instead of leaving a hole.
 */
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
  size = "panel",
}: Stat & { size?: "headline" | "panel" }) {
  const t = useT();
  return (
    <WithTooltip tooltip={tooltip}>
      <div className="w-fit min-w-0">
        <div className={LABEL_CLASS}>{label}</div>
        <div
          className={cn(
            "font-semibold whitespace-nowrap tabular-nums",
            size === "headline"
              ? "mt-1.5 text-2xl leading-none tracking-tight md:text-[1.75rem]"
              : "mt-1 text-xl leading-tight",
          )}
        >
          {value != null ? (
            <>
              <Quantity text={value} unit={unit} />
              {tag}
            </>
          ) : (
            <span className="text-muted-foreground">
              --
              <Link
                href="/settings/rider"
                className="text-primary block text-xs font-medium hover:underline"
              >
                {t("common.openSettings")}
              </Link>
            </span>
          )}
        </div>
      </div>
    </WithTooltip>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="size-2 shrink-0 rounded-[2px]"
      style={{ backgroundColor: color }}
    />
  );
}

/** A legend entry under a bar: swatch, name, then its figure. */
function CaptionItem({
  color,
  label,
  value,
  className,
}: {
  color: string;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Swatch color={color} />
      {label}
      <span className="text-foreground font-semibold tabular-nums">
        {value}
      </span>
    </span>
  );
}

/** A zone code with its swatch, the same mark the zone legend uses. */
function ZoneTag({ ramp, children }: { ramp: number; children: ReactNode }) {
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-[0.2em] text-xs font-semibold">
      <Swatch color={zoneColor(ramp)} />
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
      <div className={RAIL_CLASS}>
        <div className={cn(BAR_CLASS, "gap-0.5")}>
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
      <div className={CAPTION_CLASS}>
        {zones.map((zone) => (
          <CaptionItem
            key={zone.code}
            color={zoneColor(zone.ramp)}
            label={zone.code}
            value={`${Math.round((zone.seconds / total) * 100)} %`}
            className={cn(zone.seconds === 0 && "opacity-50")}
          />
        ))}
      </div>
    </div>
  );
}

/** How far the track reaches, as a multiple of FTP. */
const POWER_TRACK_SCALE = 1.5;

/** The power zones cut off at the track's end, as shares of its length. */
const POWER_TRACK_BANDS = (() => {
  const bands: { ramp: number; width: number }[] = [];
  let lower = 0;
  for (const zone of POWER_ZONES) {
    if (lower >= POWER_TRACK_SCALE) break;
    const upper = Math.min(zone.maxPct, POWER_TRACK_SCALE);
    bands.push({ ramp: zone.ramp, width: upper - lower });
    lower = upper;
  }
  return bands;
})();

/**
 * Variability index (NP ÷ average power) from which the power track marks
 * average next to NP. Below it the effort was steady enough that the two marks
 * would sit on top of each other.
 */
const TRACK_AVERAGE_FROM_VARIABILITY = 1.1;

const LABEL_ALIGN_CLASS = {
  start: "pl-1.5",
  center: "-translate-x-1/2",
  end: "-translate-x-full pr-1.5",
} as const;

interface TrackMark {
  label: string;
  watts: number;
  /** Position along the track, from 0 to 1. */
  at: number;
  muted?: boolean;
}

/**
 * Normalized power placed on the rider's power zones up to 150% of FTP, with
 * average power next to it when the effort was variable (or alone without
 * NP). Labels sit above the track and FTP's below, so the two rows never
 * collide; `placeTrackLabels` keeps the mark labels apart.
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
  const at = (watts: number) => Math.min(1, watts / (ftp * POWER_TRACK_SCALE));

  const both =
    normalized != null &&
    average != null &&
    normalized >= average * TRACK_AVERAGE_FROM_VARIABILITY;
  // Average first: `placeTrackLabels` expects the lower mark first.
  const marks: TrackMark[] = [];
  if (average != null && (normalized == null || both)) {
    marks.push({
      label: t("stats.average"),
      watts: average,
      at: at(average),
      muted: both,
    });
  }
  if (normalized != null) {
    marks.push({ label: "NP", watts: normalized, at: at(normalized) });
  }

  return (
    <div>
      <div className="relative h-4 text-xs">
        {placeTrackLabels(marks).map((group) => (
          <span
            key={group.marks[0].label}
            className={cn(
              "absolute flex gap-3 whitespace-nowrap",
              LABEL_ALIGN_CLASS[group.align],
            )}
            style={{ left: `${group.at * 100}%` }}
          >
            {group.marks.map((mark) => (
              <span key={mark.label}>
                <span className={LABEL_CLASS}>{mark.label}</span>{" "}
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
      <div className={RAIL_CLASS} aria-hidden>
        <div className={BAR_CLASS}>
          {POWER_TRACK_BANDS.map((band) => (
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
          style={{ left: `${at(ftp) * 100}%` }}
        />
        {marks.map((mark) => (
          <span
            key={mark.label}
            className={cn(
              "absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full",
              mark.muted ? "bg-foreground/50" : "bg-foreground",
            )}
            style={{ left: `${mark.at * 100}%` }}
          />
        ))}
      </div>
      <div className="text-muted-foreground relative mt-1 h-4 text-xs">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums"
          style={{ left: `${at(ftp) * 100}%` }}
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
  elapsed,
  color,
}: {
  moving: number;
  elapsed: number;
  color: string;
}) {
  const t = useT();
  const paused = Math.max(0, elapsed - moving);
  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        <span style={{ flex: `${moving} 0 0`, backgroundColor: color }} />
        {paused > 0 && (
          <span
            // Keep short pauses visible next to a long moving time.
            style={{
              flex: `${Math.max(paused, elapsed * 0.015)} 0 0`,
              backgroundColor: PAUSE_COLOR,
            }}
          />
        )}
      </div>
      <div className={CAPTION_CLASS}>
        {paused > 0 ? (
          <CaptionItem
            color={PAUSE_COLOR}
            label={t("stats.paused")}
            value={formatHumanDuration(paused)}
          />
        ) : (
          <span>{t("stats.noPause")}</span>
        )}
      </div>
    </div>
  );
}
