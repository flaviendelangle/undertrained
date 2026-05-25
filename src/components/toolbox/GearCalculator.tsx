import * as React from "react";

import { Button } from "~/components/ui/button";
import { NumberField } from "~/components/ui/number-field";
import { cn } from "~/lib/utils";

import {
  ToolboxTable,
  ToolboxTableBody,
  ToolboxTableCell,
  ToolboxTableHead,
  ToolboxTableHeader,
  ToolboxTableHeaderRow,
  ToolboxTableRow,
} from "./ToolboxTable";

// ── Wheel/tire sizes ──

const WHEEL_PRESETS = [
  { label: "700×23c", rimMm: 622, tireMm: 23 },
  { label: "700×25c", rimMm: 622, tireMm: 25 },
  { label: "700×28c", rimMm: 622, tireMm: 28 },
  { label: "700×32c", rimMm: 622, tireMm: 32 },
  { label: "700×38c", rimMm: 622, tireMm: 38 },
  { label: "650b×47c", rimMm: 584, tireMm: 47 },
] as const;

function wheelDiameterM(rimMm: number, tireMm: number): number {
  return (rimMm + 2 * tireMm) / 1000;
}

function wheelCircumferenceM(rimMm: number, tireMm: number): number {
  return Math.PI * wheelDiameterM(rimMm, tireMm);
}

// ── Cassette presets ──

interface CassettePreset {
  label: string;
  speeds: number;
  cogs: number[];
}

const CASSETTE_PRESETS: CassettePreset[] = [
  // 11-speed
  {
    label: "11-28 (11s)",
    speeds: 11,
    cogs: [11, 12, 13, 14, 15, 17, 19, 21, 23, 25, 28],
  },
  {
    label: "11-30 (11s)",
    speeds: 11,
    cogs: [11, 12, 13, 14, 15, 17, 19, 21, 24, 27, 30],
  },
  {
    label: "11-32 (11s)",
    speeds: 11,
    cogs: [11, 12, 13, 14, 16, 18, 20, 22, 25, 28, 32],
  },
  {
    label: "11-34 (11s)",
    speeds: 11,
    cogs: [11, 12, 13, 14, 16, 18, 20, 23, 26, 30, 34],
  },
  // 12-speed
  {
    label: "11-30 (12s)",
    speeds: 12,
    cogs: [11, 12, 13, 14, 15, 16, 17, 19, 21, 24, 27, 30],
  },
  {
    label: "11-32 (12s)",
    speeds: 12,
    cogs: [11, 12, 13, 14, 15, 16, 17, 19, 21, 24, 28, 32],
  },
  {
    label: "11-34 (12s)",
    speeds: 12,
    cogs: [11, 12, 13, 14, 15, 17, 19, 21, 24, 27, 30, 34],
  },
  {
    label: "10-33 (12s)",
    speeds: 12,
    cogs: [10, 11, 12, 13, 14, 15, 17, 19, 21, 24, 28, 33],
  },
  {
    label: "10-36 (12s)",
    speeds: 12,
    cogs: [10, 11, 12, 13, 14, 16, 18, 21, 24, 28, 32, 36],
  },
  // 10-speed
  {
    label: "11-28 (10s)",
    speeds: 10,
    cogs: [11, 12, 13, 14, 15, 17, 19, 21, 24, 28],
  },
  {
    label: "11-32 (10s)",
    speeds: 10,
    cogs: [11, 12, 14, 16, 18, 20, 22, 25, 28, 32],
  },
  {
    label: "12-25 (10s)",
    speeds: 10,
    cogs: [12, 13, 14, 15, 16, 17, 18, 19, 21, 25],
  },
];

const CHAINRING_PRESETS = [
  { label: "53/39", rings: [53, 39] },
  { label: "52/36", rings: [52, 36] },
  { label: "50/34", rings: [50, 34] },
  { label: "48/32", rings: [48, 32] },
  { label: "1× 42", rings: [42] },
  { label: "1× 40", rings: [40] },
  { label: "1× 38", rings: [38] },
];

// ── Helpers ──

function parseRings(input: string): number[] {
  return input
    .split(/[/\-,\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0)
    .sort((a, b) => b - a);
}

function parseCogs(input: string): number[] {
  const parts = input
    .split(/[/\-,\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
  return [...new Set(parts)].sort((a, b) => a - b);
}

type ViewTab = "ratio" | "speed" | "development";

// ── Color scale ──

function ratioColor(ratio: number, minRatio: number, maxRatio: number): string {
  const t =
    maxRatio === minRatio ? 0.5 : (ratio - minRatio) / (maxRatio - minRatio);
  // green (easy) → yellow → red (hard)
  const hue = (1 - t) * 120; // 120=green, 0=red
  return `hsl(${hue}, 70%, 42%)`;
}

// ── Component ──

export function GearCalculator() {
  const [ringsInput, setRingsInput] = React.useState("52/36");
  const [cogsInput, setCogsInput] = React.useState(
    "11,12,13,14,16,18,20,22,25,28,32",
  );
  const [wheelPreset, setWheelPreset] = React.useState("700×25c");
  const [cadence, setCadence] = React.useState<number | null>(90);
  const [viewTab, setViewTab] = React.useState<ViewTab>("ratio");

  const rings = React.useMemo(() => parseRings(ringsInput), [ringsInput]);
  const cogs = React.useMemo(() => parseCogs(cogsInput), [cogsInput]);

  const wheel =
    WHEEL_PRESETS.find((w) => w.label === wheelPreset) ?? WHEEL_PRESETS[1];
  const circumference = wheelCircumferenceM(wheel.rimMm, wheel.tireMm);

  // All ratios for color scale
  const allRatios = React.useMemo(() => {
    const ratios: number[] = [];
    for (const ring of rings) {
      for (const cog of cogs) {
        ratios.push(ring / cog);
      }
    }
    return ratios;
  }, [rings, cogs]);

  const minRatio = Math.min(...allRatios);
  const maxRatio = Math.max(...allRatios);

  const applyCassettePreset = (preset: CassettePreset) => {
    setCogsInput(preset.cogs.join(","));
  };

  const applyChainringPreset = (preset: { rings: number[] }) => {
    setRingsInput(preset.rings.join("/"));
  };

  return (
    <div className="divide-border border-border flex w-full flex-col divide-y border-b md:mx-auto md:max-w-4xl md:gap-6 md:divide-y-0 md:border-0">
      {/* Input Card */}
      <div className="md:border-border md:bg-card p-4 md:rounded-sm md:border md:p-6">
        <div className="flex flex-col gap-5">
          {/* Chainrings */}
          <div>
            <label className="text-muted-foreground mb-1.5 block text-sm font-medium">
              Chainrings
            </label>
            <input
              type="text"
              value={ringsInput}
              onChange={(e) => setRingsInput(e.target.value)}
              placeholder="52/36"
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 mb-2 w-40 rounded-md border px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:ring-3"
            />
            <div className="flex flex-wrap gap-1">
              {CHAINRING_PRESETS.map((p) => (
                <Button
                  key={p.label}
                  variant={
                    rings.join("/") === p.rings.join("/")
                      ? "default"
                      : "outline"
                  }
                  size="xs"
                  onClick={() => applyChainringPreset(p)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Cassette */}
          <div>
            <label className="text-muted-foreground mb-1.5 block text-sm font-medium">
              Cassette
            </label>
            <input
              type="text"
              value={cogsInput}
              onChange={(e) => setCogsInput(e.target.value)}
              placeholder="11,12,13,14,16,18,20,22,25,28,32"
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 mb-2 w-full max-w-sm rounded-md border px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:ring-3"
            />
            <div className="flex flex-wrap gap-1">
              {CASSETTE_PRESETS.map((p) => (
                <Button
                  key={p.label}
                  variant={
                    cogs.join(",") === p.cogs.join(",") ? "default" : "outline"
                  }
                  size="xs"
                  onClick={() => applyCassettePreset(p)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Wheel size + Cadence */}
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-muted-foreground mb-1.5 block text-sm font-medium">
                Wheel size
              </label>
              <div className="flex flex-wrap gap-1">
                {WHEEL_PRESETS.map((w) => (
                  <Button
                    key={w.label}
                    variant={wheelPreset === w.label ? "default" : "outline"}
                    size="xs"
                    onClick={() => setWheelPreset(w.label)}
                  >
                    {w.label}
                  </Button>
                ))}
              </div>
            </div>
            {viewTab === "speed" && (
              <div>
                <label className="text-muted-foreground mb-1.5 block text-sm font-medium">
                  Cadence
                </label>
                <div className="flex items-center gap-1.5">
                  <NumberField
                    min={30}
                    max={200}
                    value={cadence}
                    onValueChange={setCadence}
                    className="w-24"
                  />
                  <span className="text-muted-foreground text-sm">rpm</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* View tabs + Table */}
      {rings.length > 0 && cogs.length > 0 && (
        <div className="md:border-border md:bg-card md:rounded-sm md:border">
          <div className="flex items-center gap-1.5 px-4 pt-4 md:px-6 md:pt-6">
            <Button
              variant={viewTab === "ratio" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewTab("ratio")}
            >
              Gear Ratio
            </Button>
            <Button
              variant={viewTab === "speed" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewTab("speed")}
            >
              Speed
            </Button>
            <Button
              variant={viewTab === "development" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewTab("development")}
            >
              Development
            </Button>
          </div>
          <div className="px-4 pt-1 pb-2 md:px-6">
            <p className="text-muted-foreground text-sm">
              {viewTab === "ratio" && "Chainring teeth ÷ cog teeth"}
              {viewTab === "speed" && `Speed (km/h) at ${cadence ?? 90} rpm`}
              {viewTab === "development" &&
                "Distance per pedal revolution (meters)"}
            </p>
          </div>

          <ToolboxTable>
            <ToolboxTableHeader>
              <ToolboxTableHeaderRow>
                <ToolboxTableHead first>Cog</ToolboxTableHead>
                {rings.map((ring) => (
                  <ToolboxTableHead key={ring} className="text-center">
                    {ring}T
                  </ToolboxTableHead>
                ))}
              </ToolboxTableHeaderRow>
            </ToolboxTableHeader>
            <ToolboxTableBody>
              {cogs.map((cog) => (
                <ToolboxTableRow key={cog}>
                  <ToolboxTableCell first className="tabular-nums">
                    {cog}T
                  </ToolboxTableCell>
                  {rings.map((ring) => {
                    const ratio = ring / cog;
                    let cellValue: string;
                    if (viewTab === "ratio") {
                      cellValue = ratio.toFixed(2);
                    } else if (viewTab === "speed") {
                      const rpm = cadence ?? 90;
                      const speedKmh =
                        (ratio * circumference * rpm * 60) / 1000;
                      cellValue = speedKmh.toFixed(1);
                    } else {
                      const dev = ratio * circumference;
                      cellValue = dev.toFixed(2);
                    }

                    return (
                      <ToolboxTableCell
                        key={ring}
                        className="text-center tabular-nums"
                      >
                        <span
                          className={cn(
                            "inline-block min-w-[3.5rem] rounded px-1.5 py-0.5 text-white",
                          )}
                          style={{
                            backgroundColor: ratioColor(
                              ratio,
                              minRatio,
                              maxRatio,
                            ),
                          }}
                        >
                          {cellValue}
                        </span>
                      </ToolboxTableCell>
                    );
                  })}
                </ToolboxTableRow>
              ))}
            </ToolboxTableBody>
          </ToolboxTable>

          {/* Summary */}
          <div className="text-muted-foreground border-t px-4 py-3 text-xs md:px-6">
            {cogs.length} speeds × {rings.length} chainring
            {rings.length > 1 ? "s" : ""} = {cogs.length * rings.length} gear
            combinations — Ratio range: {minRatio.toFixed(2)} to{" "}
            {maxRatio.toFixed(2)} — Wheel: {wheel.label} (
            {(circumference * 1000).toFixed(0)}mm circumference)
          </div>
        </div>
      )}
    </div>
  );
}
