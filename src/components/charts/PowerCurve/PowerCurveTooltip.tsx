import * as React from "react";

import Link from "next/link";

import {
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipSurface,
} from "../ChartTooltipSurface";
import { formatDuration } from "./formatDuration";
import type { ActivityInfo } from "./types";

interface TooltipEntry {
  id: string;
  label: string;
  color: string;
  value: number | null;
  unit: string;
  activity: ActivityInfo | null;
}

interface PowerCurveTooltipProps {
  clientX: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  duration: number;
  entries: TooltipEntry[];
  frozen: boolean;
}

function formatValue(value: number, unit: string): string {
  if (unit === "W") return `${Math.round(value)} W`;
  return `${value.toFixed(2)} W/kg`;
}

export const PowerCurveTooltip = React.memo(function PowerCurveTooltip({
  clientX,
  containerRef,
  duration,
  entries,
  frozen,
}: PowerCurveTooltipProps) {
  const [containerTop, setContainerTop] = React.useState(0);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const [clampedLeft, setClampedLeft] = React.useState(clientX);

  React.useLayoutEffect(() => {
    setContainerTop(containerRef.current?.getBoundingClientRect().top ?? 0);
    const tooltipWidth = tooltipRef.current?.offsetWidth ?? 0;
    const halfWidth = tooltipWidth / 2;
    const minLeft = halfWidth;
    const maxLeft = window.innerWidth - halfWidth;
    setClampedLeft(Math.max(minLeft, Math.min(maxLeft, clientX)));
  }, [containerRef, clientX]);

  return (
    <div
      ref={tooltipRef}
      className="fixed z-50"
      style={{
        left: clampedLeft,
        top: containerTop + 16,
        transform: "translateX(-50%)",
        pointerEvents: frozen ? "auto" : "none",
      }}
    >
      <ChartTooltipSurface>
        <ChartTooltipHeader>{formatDuration(duration)}</ChartTooltipHeader>
        <div className="flex flex-col gap-1">
          {entries.map((entry) => {
            if (entry.value == null) return null;
            return (
              <ChartTooltipRow
                key={entry.id}
                color={entry.color}
                label={entry.label}
                value={formatValue(entry.value, entry.unit)}
                trailing={
                  entry.activity && (
                    <Link
                      href={`/activities/${entry.activity.activityStravaId}`}
                      className="text-muted-foreground hover:text-foreground text-xs underline"
                    >
                      {entry.activity.activityName}
                    </Link>
                  )
                }
              />
            );
          })}
        </div>
      </ChartTooltipSurface>
    </div>
  );
});
