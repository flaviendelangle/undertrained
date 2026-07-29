import * as React from "react";

import { ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { powerZoneLabel, powerZoneShortLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { cn } from "~/lib/utils";
import {
  MAX_TARGET_POWER_WATTS,
  POWER_ZONES,
  getPowerZoneIndex,
} from "~/sensors/types";
import type { PowerTarget } from "~/utils/structuredWorkout";
import { MAX_FTP_PCT, roundPct } from "~/utils/structuredWorkout";

/**
 * The intensity control: a zone chip row, a %FTP input and the watts it works
 * out to at the athlete's FTP.
 *
 * Zone-first rather than slider-first, because riders think in zones ("threshold
 * for twenty") and only reach for a number to fine-tune. Tapping Z4 lands on
 * that zone's midpoint; the arrows then move in 1 % steps.
 */

const PCT_STEP = 0.01;

/**
 * The %FTP a zone chip writes: the middle of the zone's band. The open-topped
 * top zone has no midpoint, so it uses a value that is unambiguously in it
 * without being an unrideable sprint target.
 */
export function zoneMidPct(index: number): number {
  const zone = POWER_ZONES[index];
  const lower = index === 0 ? 0 : POWER_ZONES[index - 1].maxPct;
  if (!Number.isFinite(zone.maxPct)) return roundPct(lower + 0.2);
  return roundPct((lower + zone.maxPct) / 2);
}

/** Watts for a %FTP, or null when the athlete has no FTP configured. */
function wattsFor(pct: number, ftp: number | null): number | null {
  return ftp == null ? null : Math.round(pct * ftp);
}

/**
 * Upper bound on an authored target. `MAX_FTP_PCT` is the absolute cap, but a
 * high-FTP rider hits the trainer layer's watt ceiling first — and a target the
 * trainer will silently truncate is worse than one the field refuses.
 */
function maxPctFor(ftp: number | null): number {
  if (ftp == null || ftp <= 0) return MAX_FTP_PCT;
  return Math.min(MAX_FTP_PCT, MAX_TARGET_POWER_WATTS / ftp);
}

function PctInput({
  value,
  onChange,
  ftp,
  label,
  max,
}: {
  value: number;
  onChange: (pct: number) => void;
  ftp: number | null;
  label: string;
  max: number;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const percent = Math.round(value * 100);

  const commit = (text: string) => {
    setDraft(null);
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return;
    onChange(roundPct(Math.min(max, Math.max(0, parsed / 100))));
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={draft ?? String(percent)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
          } else if (event.key === "Escape") {
            setDraft(null);
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            setDraft(null);
            const delta = event.key === "ArrowUp" ? PCT_STEP : -PCT_STEP;
            onChange(roundPct(Math.min(max, Math.max(0, value + delta))));
          }
        }}
        className="border-input bg-background focus-visible:ring-ring h-7 w-12 rounded-md border px-1 text-center font-mono text-sm tabular-nums outline-none focus-visible:ring-1"
      />
      <span className="text-muted-foreground text-xs">%</span>
      {ftp != null && (
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {wattsFor(value, ftp)} W
        </span>
      )}
    </span>
  );
}

interface PowerTargetFieldProps {
  value: PowerTarget;
  onChange: (target: PowerTarget) => void;
  /** null when the athlete has no FTP saved — watts are then hidden, not faked. */
  ftp: number | null;
  /** Zone chips only appear on the selected row, to keep the list scannable. */
  expanded?: boolean;
}

export function PowerTargetField({
  value,
  onChange,
  ftp,
  expanded = false,
}: PowerTargetFieldProps) {
  const t = useT();
  const tokens = useChartTokens();
  const max = maxPctFor(ftp);

  const KIND_LABEL: Record<PowerTarget["kind"], string> = {
    pct: t("workouts.step.kind.pct"),
    pctRange: t("workouts.step.kind.pctRange"),
    ramp: t("workouts.step.kind.ramp"),
    free: t("workouts.step.kind.free"),
  };

  /**
   * Switching kinds carries the current intensity across so the step keeps its
   * place in the profile — going steady → ramp should not reset to zero.
   */
  const switchKind = (kind: PowerTarget["kind"]) => {
    const current =
      value.kind === "pct"
        ? value.pct
        : value.kind === "pctRange"
          ? (value.low + value.high) / 2
          : value.kind === "ramp"
            ? value.to
            : 0.6;

    switch (kind) {
      case "pct":
        onChange({ kind: "pct", pct: roundPct(current) });
        break;
      case "pctRange":
        onChange({
          kind: "pctRange",
          low: roundPct(Math.max(0, current - 0.05)),
          high: roundPct(Math.min(max, current + 0.05)),
        });
        break;
      case "ramp":
        onChange({
          kind: "ramp",
          from: roundPct(Math.max(0, current - 0.2)),
          to: roundPct(current),
        });
        break;
      case "free":
        onChange({ kind: "free" });
        break;
    }
  };

  const activeZone =
    value.kind === "pct" ? getPowerZoneIndex(value.pct, 1) : null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("workouts.step.kind.label")}
            className="border-input text-muted-foreground hover:text-foreground flex h-7 items-center gap-1 rounded-md border px-2 text-xs"
          >
            {KIND_LABEL[value.kind]}
            <ChevronDownIcon className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(Object.keys(KIND_LABEL) as PowerTarget["kind"][]).map((kind) => (
              <DropdownMenuItem key={kind} onClick={() => switchKind(kind)}>
                {KIND_LABEL[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {value.kind === "pct" && (
          <PctInput
            value={value.pct}
            max={max}
            ftp={ftp}
            label={t("workouts.step.percentFtp")}
            onChange={(pct) => onChange({ kind: "pct", pct })}
          />
        )}

        {value.kind === "pctRange" && (
          <>
            <PctInput
              value={value.low}
              max={max}
              ftp={ftp}
              label={t("workouts.step.powerLow")}
              onChange={(low) =>
                onChange({
                  kind: "pctRange",
                  low,
                  high: Math.max(low, value.high),
                })
              }
            />
            <span className="text-muted-foreground text-xs">–</span>
            <PctInput
              value={value.high}
              max={max}
              ftp={ftp}
              label={t("workouts.step.powerHigh")}
              onChange={(high) =>
                onChange({
                  kind: "pctRange",
                  low: Math.min(value.low, high),
                  high,
                })
              }
            />
          </>
        )}

        {value.kind === "ramp" && (
          <>
            <PctInput
              value={value.from}
              max={max}
              ftp={ftp}
              label={t("workouts.step.powerFrom")}
              onChange={(from) =>
                onChange({ kind: "ramp", from, to: value.to })
              }
            />
            <span className="text-muted-foreground text-xs">→</span>
            <PctInput
              value={value.to}
              max={max}
              ftp={ftp}
              label={t("workouts.step.powerTo")}
              onChange={(to) =>
                onChange({ kind: "ramp", from: value.from, to })
              }
            />
          </>
        )}
      </div>

      {/* Zone chips: only meaningful for a single steady target, and only worth
          the vertical space on the row being edited. */}
      {expanded && value.kind === "pct" && (
        <div className="-mx-1 flex snap-x gap-1 overflow-x-auto px-1 pb-1">
          {POWER_ZONES.map((zone, index) => {
            const isActive = activeZone === index;
            return (
              <button
                key={zone.name}
                type="button"
                title={powerZoneLabel(index, t)}
                onClick={() =>
                  onChange({ kind: "pct", pct: zoneMidPct(index) })
                }
                style={{
                  borderColor: tokens.zones[zone.ramp],
                  backgroundColor: isActive
                    ? tokens.zones[zone.ramp]
                    : undefined,
                }}
                className={cn(
                  "h-7 shrink-0 snap-start rounded-md border px-2.5 text-xs font-medium transition-colors",
                  isActive ? "text-white" : "text-muted-foreground",
                )}
              >
                {powerZoneShortLabel(index)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
