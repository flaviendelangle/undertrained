import * as React from "react";

import { Button } from "~/components/ui/button";
import { NumberField } from "~/components/ui/number-field";
import { formatDuration, formatMinutesSeconds } from "~/utils/format";

import {
  ToolboxTable,
  ToolboxTableBody,
  ToolboxTableCell,
  ToolboxTableHead,
  ToolboxTableHeader,
  ToolboxTableHeaderRow,
  ToolboxTableRow,
} from "./ToolboxTable";

const DISTANCES = [
  { label: "Marathon", km: 42.195 },
  { label: "Half Marathon", km: 21.0975 },
  { label: "10 km", km: 10 },
  { label: "5 km", km: 5 },
] as const;

// Generate pace rows from 2:30 to 9:00 in 5-second increments
const paceRows = (() => {
  const rows: { paceLabel: string; paceSeconds: number }[] = [];
  for (let sec = 150; sec <= 540; sec += 1) {
    const paceMin = Math.floor(sec / 60);
    const paceSec = sec % 60;
    rows.push({
      paceLabel: `${paceMin}:${String(paceSec).padStart(2, "0")}`,
      paceSeconds: sec,
    });
  }
  return rows;
})();

type Mode = "pace-to-duration" | "duration-to-pace";

export function PaceCalculator() {
  const [mode, setMode] = React.useState<Mode>("pace-to-duration");

  // Distance selection
  const [selectedDistance, setSelectedDistance] = React.useState<string>("Marathon");
  const [customKm, setCustomKm] = React.useState<number | null>(15);

  // Pace inputs (for pace-to-duration mode)
  const [paceMinutes, setPaceMinutes] = React.useState<number | null>(5);
  const [paceSeconds, setPaceSeconds] = React.useState<number | null>(0);

  // Duration inputs (for duration-to-pace mode)
  const [durationHours, setDurationHours] = React.useState<number | null>(3);
  const [durationMinutes, setDurationMinutes] = React.useState<number | null>(30);
  const [durationSeconds, setDurationSeconds] = React.useState<number | null>(0);

  const distanceKm =
    selectedDistance === "Custom"
      ? customKm
      : DISTANCES.find((d) => d.label === selectedDistance)?.km ?? null;

  const computedResult = React.useMemo(() => {
    if (distanceKm == null || distanceKm <= 0) return null;

    if (mode === "pace-to-duration") {
      const totalPaceSec = (paceMinutes ?? 0) * 60 + (paceSeconds ?? 0);
      if (totalPaceSec <= 0) return null;
      const totalDuration = totalPaceSec * distanceKm;
      return formatDuration(totalDuration);
    } else {
      const totalDurSec =
        (durationHours ?? 0) * 3600 +
        (durationMinutes ?? 0) * 60 +
        (durationSeconds ?? 0);
      if (totalDurSec <= 0) return null;
      const pacePerKm = totalDurSec / distanceKm;
      return `${formatMinutesSeconds(pacePerKm)} /km`;
    }
  }, [
    mode,
    distanceKm,
    paceMinutes,
    paceSeconds,
    durationHours,
    durationMinutes,
    durationSeconds,
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/* Converter Widget */}
      <div className="bg-card rounded-sm border max-sm:border-0 p-4 md:p-6">
        {/* Mode toggle */}
        <div className="mb-4 flex gap-1.5">
          <Button
            variant={mode === "pace-to-duration" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("pace-to-duration")}
          >
            Pace → Duration
          </Button>
          <Button
            variant={mode === "duration-to-pace" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("duration-to-pace")}
          >
            Duration → Pace
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Left side: inputs */}
          <div className="flex flex-col gap-4">
            {/* Distance picker */}
            <div>
              <label className="text-muted-foreground mb-1.5 block text-sm font-medium">
                Distance
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[...DISTANCES, { label: "Custom" as const, km: null }].map(
                  (d) => (
                    <Button
                      key={d.label}
                      variant={
                        selectedDistance === d.label ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => setSelectedDistance(d.label)}
                    >
                      {d.label}
                    </Button>
                  ),
                )}
              </div>
              {selectedDistance === "Custom" && (
                <div className="mt-2 flex items-center gap-1.5">
                  <NumberField
                    min={0.1}
                    step={0.1}
                    value={customKm}
                    onValueChange={(val) => setCustomKm(val)}
                    className="w-24"
                  />
                  <span className="text-muted-foreground text-sm">km</span>
                </div>
              )}
            </div>

            {/* Pace or Duration input */}
            {mode === "pace-to-duration" ? (
              <div>
                <label className="text-muted-foreground mb-1.5 block text-sm font-medium">
                  Pace
                </label>
                <div className="flex items-center gap-1.5">
                  <NumberField
                    min={0}
                    max={59}
                    value={paceMinutes}
                    onValueChange={(val) => setPaceMinutes(val)}
                    className="w-20"
                  />
                  <span className="text-muted-foreground font-medium">:</span>
                  <NumberField
                    min={0}
                    max={59}
                    value={paceSeconds}
                    onValueChange={(val) => setPaceSeconds(val)}
                    className="w-20"
                  />
                  <span className="text-muted-foreground text-sm">/km</span>
                </div>
              </div>
            ) : (
              <div>
                <label className="text-muted-foreground mb-1.5 block text-sm font-medium">
                  Duration
                </label>
                <div className="flex items-center gap-1.5">
                  <NumberField
                    min={0}
                    max={23}
                    value={durationHours}
                    onValueChange={(val) => setDurationHours(val)}
                    className="w-20"
                  />
                  <span className="text-muted-foreground font-medium">:</span>
                  <NumberField
                    min={0}
                    max={59}
                    value={durationMinutes}
                    onValueChange={(val) => setDurationMinutes(val)}
                    className="w-20"
                  />
                  <span className="text-muted-foreground font-medium">:</span>
                  <NumberField
                    min={0}
                    max={59}
                    value={durationSeconds}
                    onValueChange={(val) => setDurationSeconds(val)}
                    className="w-20"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right side: result */}
          <div className="flex flex-col items-start justify-center md:items-center">
            <span className="text-muted-foreground mb-1 text-sm font-medium">
              {mode === "pace-to-duration" ? "Finish Time" : "Pace"}
            </span>
            <span className="text-foreground text-3xl font-bold tabular-nums">
              {computedResult ?? "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Reference Table */}
      <div className="bg-card rounded-sm border max-sm:border-0">
        <div className="px-4 pt-4 pb-2 md:px-6 md:pt-6">
          <h2 className="text-foreground text-lg font-semibold">
            Pace Reference Table
          </h2>
          <p className="text-muted-foreground text-sm">
            Finish times for common distances at each pace
          </p>
        </div>
        <ToolboxTable containerClassName="max-h-[600px]">
          <ToolboxTableHeader>
            <ToolboxTableHeaderRow>
              <ToolboxTableHead first>Pace /km</ToolboxTableHead>
              {DISTANCES.map((d) => (
                <ToolboxTableHead key={d.label}>{d.label}</ToolboxTableHead>
              ))}
            </ToolboxTableHeaderRow>
          </ToolboxTableHeader>
          <ToolboxTableBody>
            {paceRows.map((row) => (
              <ToolboxTableRow key={row.paceSeconds}>
                <ToolboxTableCell first>
                  {row.paceLabel}
                </ToolboxTableCell>
                {DISTANCES.map((d) => (
                  <ToolboxTableCell
                    key={d.label}
                    className="text-muted-foreground tabular-nums"
                  >
                    {formatDuration(row.paceSeconds * d.km)}
                  </ToolboxTableCell>
                ))}
              </ToolboxTableRow>
            ))}
          </ToolboxTableBody>
        </ToolboxTable>
      </div>
    </div>
  );
}
