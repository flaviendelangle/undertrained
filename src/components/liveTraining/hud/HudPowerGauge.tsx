import { powerZoneLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { POWER_ZONES, getPowerZoneIndex } from "~/sensors/types";

interface HudPowerGaugeProps {
  power: number | null;
  ftp: number;
  weightKg?: number;
  /** ERG / workout target, drawn as a tick and an in-target band on the arc. */
  targetPower?: number | null;
  /** Half-width of the in-target band, in watts. */
  toleranceWatts?: number;
}

const SIZE = 280;
const CENTER = SIZE / 2;
const RADIUS = 120;
const STROKE_WIDTH = 14;
const START_ANGLE = 135; // degrees
const END_ANGLE = 405; // degrees (135 + 270)
const TOTAL_ARC = END_ANGLE - START_ANGLE; // 270 degrees

function polarToCartesian(angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return {
    x: CENTER + RADIUS * Math.cos(rad),
    y: CENTER + RADIUS * Math.sin(rad),
  };
}

function describeArc(startAngle: number, endAngle: number): string {
  const start = polarToCartesian(endAngle);
  const end = polarToCartesian(startAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

export function HudPowerGauge({
  power,
  ftp,
  weightKg,
  targetPower,
  toleranceWatts,
}: HudPowerGaugeProps) {
  const t = useT();
  const tokens = useChartTokens();
  const currentZoneIdx = getPowerZoneIndex(power ?? 0, ftp);
  const wattsPerKg =
    power != null && weightKg ? (power / weightKg).toFixed(1) : null;

  // Build zone arc segments
  const zoneArcs = POWER_ZONES.map((zone, i) => {
    const prevMaxPct = i > 0 ? POWER_ZONES[i - 1].maxPct : 0;
    const maxPct = Math.min(zone.maxPct, 2.0); // cap for display

    const startFrac = Math.min(prevMaxPct / 2.0, 1);
    const endFrac = Math.min(maxPct / 2.0, 1);

    const arcStart = START_ANGLE + startFrac * TOTAL_ARC;
    const arcEnd = START_ANGLE + endFrac * TOTAL_ARC;

    if (arcEnd <= arcStart) return null;

    const isActive = power != null && i === currentZoneIdx;

    return (
      <path
        key={zone.name}
        d={describeArc(arcStart, arcEnd)}
        fill="none"
        stroke={tokens.zones[zone.ramp]}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        opacity={isActive ? 1 : 0.2}
        style={{ transition: "opacity 0.3s ease-out" }}
      />
    );
  });

  // The arc spans 0 → 200 % FTP, so a target maps onto it the same way a live
  // power reading does.
  const angleFor = (watts: number) =>
    START_ANGLE + Math.min(watts / (ftp * 2), 1) * TOTAL_ARC;

  const targetTick =
    targetPower != null && targetPower > 0
      ? (() => {
          const angle = angleFor(targetPower);
          const rad = (angle * Math.PI) / 180;
          const reach = STROKE_WIDTH / 2 + 4;
          return {
            inner: {
              x: CENTER + (RADIUS - reach) * Math.cos(rad),
              y: CENTER + (RADIUS - reach) * Math.sin(rad),
            },
            outer: {
              x: CENTER + (RADIUS + reach) * Math.cos(rad),
              y: CENTER + (RADIUS + reach) * Math.sin(rad),
            },
          };
        })()
      : null;

  const targetBand =
    targetPower != null && targetPower > 0 && toleranceWatts
      ? (() => {
          const start = angleFor(Math.max(0, targetPower - toleranceWatts));
          const end = angleFor(targetPower + toleranceWatts);
          return end > start ? { start, end } : null;
        })()
      : null;

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Background arc */}
        <path
          d={describeArc(START_ANGLE, END_ANGLE)}
          fill="none"
          className="stroke-border"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
        {/* Zone segments */}
        {zoneArcs}
        {/* Target marker: lets the rider hold the number peripherally instead
            of reading it, which is the whole point of a gauge. */}
        {targetBand && (
          <path
            d={describeArc(targetBand.start, targetBand.end)}
            fill="none"
            stroke={tokens.accent}
            strokeWidth={STROKE_WIDTH}
            opacity={0.25}
          />
        )}
        {targetTick && (
          <line
            x1={targetTick.inner.x}
            y1={targetTick.inner.y}
            x2={targetTick.outer.x}
            y2={targetTick.outer.y}
            stroke={tokens.accent}
            strokeWidth={3}
            strokeLinecap="round"
          />
        )}
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-foreground font-mono text-7xl font-bold">
          {power ?? "--"}
        </span>
        {power != null && (
          <span
            className="mt-1 text-lg font-semibold"
            style={{ color: tokens.zones[POWER_ZONES[currentZoneIdx].ramp] }}
          >
            {powerZoneLabel(currentZoneIdx, t)}
          </span>
        )}
        {wattsPerKg && (
          <span className="text-muted-foreground text-sm">
            {wattsPerKg} W/kg
          </span>
        )}
      </div>
    </div>
  );
}
