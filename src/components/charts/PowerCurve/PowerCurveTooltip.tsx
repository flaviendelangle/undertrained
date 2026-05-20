import * as React from "react";

import Link from "next/link";

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
    setContainerTop(
      containerRef.current?.getBoundingClientRect().top ?? 0,
    );
    const tooltipWidth = tooltipRef.current?.offsetWidth ?? 0;
    const halfWidth = tooltipWidth / 2;
    const minLeft = halfWidth;
    const maxLeft = window.innerWidth - halfWidth;
    setClampedLeft(Math.max(minLeft, Math.min(maxLeft, clientX)));
  }, [containerRef, clientX]);

  return (
    <div
      ref={tooltipRef}
      className="border-border bg-popover/95 fixed z-50 rounded-md border px-3 py-2 text-xs shadow-lg backdrop-blur-sm"
      style={{
        left: clampedLeft,
        top: containerTop + 16,
        transform: "translateX(-50%)",
        pointerEvents: frozen ? "auto" : "none",
      }}
    >
      <p className="text-muted-foreground mb-1 text-xs">
        {formatDuration(duration)}
      </p>
      <div className="flex flex-col gap-1">
        {entries.map((entry) => {
          if (entry.value == null) return null;
          return (
            <div
              key={entry.id}
              className="flex items-center gap-2 text-sm whitespace-nowrap"
            >
              <span
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span>{entry.label}</span>
              <span className="font-medium">
                {formatValue(entry.value, entry.unit)}
              </span>
              {entry.activity && (
                <Link
                  href={`/activities/${entry.activity.activityStravaId}`}
                  className="text-muted-foreground hover:text-foreground text-xs underline"
                >
                  {entry.activity.activityName}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
