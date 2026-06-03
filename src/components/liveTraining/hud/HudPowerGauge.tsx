import { useChartTokens } from "~/lib/chartTokens";
import { POWER_ZONES, getPowerZoneIndex } from "~/sensors/types";

interface HudPowerGaugeProps {
  power: number | null;
  ftp: number;
  weightKg?: number;
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

export function HudPowerGauge({ power, ftp, weightKg }: HudPowerGaugeProps) {
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
            {POWER_ZONES[currentZoneIdx].name}
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
