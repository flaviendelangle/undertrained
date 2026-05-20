import * as React from "react";

import { InfoIcon, PlusIcon, XIcon } from "lucide-react";
import { useSession } from "next-auth/react";

import { Button } from "~/components/ui/button";
import { NumberField } from "~/components/ui/number-field";
import {
  ToolboxTable,
  ToolboxTableBody,
  ToolboxTableCell,
  ToolboxTableHead,
  ToolboxTableHeader,
  ToolboxTableHeaderRow,
  ToolboxTableRow,
} from "~/components/toolbox/ToolboxTable";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { useRiderSettings } from "~/hooks/useRiderSettings";
import { POWER_ZONES } from "~/sensors/types";
import { formatMinutesSeconds } from "~/utils/format";

const HR_ZONES = [
  { name: "Recovery", minPct: 0.5, maxPct: 0.6, color: "#808080" },
  { name: "Aerobic", minPct: 0.6, maxPct: 0.7, color: "#3B82F6" },
  { name: "Tempo", minPct: 0.7, maxPct: 0.8, color: "#22C55E" },
  { name: "Threshold", minPct: 0.8, maxPct: 0.9, color: "#EAB308" },
  { name: "VO2max", minPct: 0.9, maxPct: 1.0, color: "#EF4444" },
] as const;

type Tab = "power" | "heart-rate" | "running-pace";

type ReferenceType = "marathon" | "half-marathon" | "10k" | "5k" | "vma";

const RACE_DISTANCES: Record<Exclude<ReferenceType, "vma">, { label: string; meters: number }> = {
  marathon: { label: "Marathon", meters: 42195 },
  "half-marathon": { label: "Half Marathon", meters: 21097.5 },
  "10k": { label: "10K", meters: 10000 },
  "5k": { label: "5K", meters: 5000 },
};

const REFERENCE_OPTIONS: { id: ReferenceType; label: string }[] = [
  { id: "marathon", label: "Marathon" },
  { id: "half-marathon", label: "Half Marathon" },
  { id: "10k", label: "10K" },
  { id: "5k", label: "5K" },
  { id: "vma", label: "VMA" },
];

// --- Jack Daniels VDOT formulas ---

/** Oxygen cost of running at velocity v (meters/min) */
function oxygenCost(v: number): number {
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

/** Fraction of VO2max sustainable for t minutes */
function pctVO2max(t: number): number {
  return (
    0.8 +
    0.1894393 * Math.exp(-0.012778 * t) +
    0.2989558 * Math.exp(-0.1932605 * t)
  );
}

/** Compute VDOT from race distance (meters) and time (minutes) */
function computeVdot(distanceMeters: number, timeMinutes: number): number {
  const v = distanceMeters / timeMinutes;
  return oxygenCost(v) / pctVO2max(timeMinutes);
}

/** Convert VMA (km/h) to VDOT */
function vdotFromVma(vmaKmh: number): number {
  // VMA in m/min, then compute VO2 at that speed — that IS VO2max by definition
  const vMetersPerMin = (vmaKmh * 1000) / 60;
  return oxygenCost(vMetersPerMin);
}

/** Convert a target %VO2max to pace in seconds/km */
function paceSecondsPerKmFromVdotPct(vdot: number, pct: number): number {
  const targetVO2 = vdot * pct;
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - targetVO2;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return 0;
  const v = (-b + Math.sqrt(discriminant)) / (2 * a); // meters/min
  if (v <= 0) return 0;
  return (1000 / v) * 60; // seconds per km
}

/** Predict race time (in minutes) for a given distance using bisection */
function predictRaceTime(vdot: number, distanceMeters: number): number {
  // Find t such that computeVdot(distanceMeters, t) = vdot
  let lo = 1;
  let hi = 600;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const computed = computeVdot(distanceMeters, mid);
    if (computed > vdot) {
      lo = mid; // running too fast (time too short)
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

interface RaceRef {
  type: ReferenceType;
  hours: number | null;
  minutes: number | null;
  seconds: number | null;
  vma: number | null;
}

function getVdotFromRef(ref: RaceRef): number | null {
  if (ref.type === "vma") {
    if (ref.vma == null || ref.vma <= 0) return null;
    return vdotFromVma(ref.vma);
  }

  const dist = RACE_DISTANCES[ref.type];
  const totalSeconds =
    (ref.hours ?? 0) * 3600 + (ref.minutes ?? 0) * 60 + (ref.seconds ?? 0);
  if (totalSeconds <= 0) return null;
  return computeVdot(dist.meters, totalSeconds / 60);
}

// --- Component ---

export function ZoneCalculator() {
  const { status } = useSession();
  const isLoggedIn = status === "authenticated";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {isLoggedIn ? <ZoneCalculatorLoggedIn /> : <ZoneCalculatorAnonymous />}
    </div>
  );
}

function ZoneCalculatorLoggedIn() {
  const [settings] = useRiderSettings();
  const [tab, setTab] = React.useState<Tab>("heart-rate");
  const [ftp, setFtp] = React.useState<number | null>(settings.ftp);
  const [weightKg, setWeightKg] = React.useState<number | null>(
    settings.weightKg,
  );
  const [maxHr, setMaxHr] = React.useState<number | null>(settings.maxHr);
  const [restingHr, setRestingHr] = React.useState<number | null>(
    settings.restingHr,
  );

  // Running pace state
  const [ref1, setRef1] = React.useState<RaceRef>({
    type: "10k",
    hours: 0,
    minutes: 45,
    seconds: 0,
    vma: 15,
  });
  const [useSecondRef, setUseSecondRef] = React.useState(false);
  const [ref2, setRef2] = React.useState<RaceRef>({
    type: "half-marathon",
    hours: 1,
    minutes: 40,
    seconds: 0,
    vma: null,
  });

  return (
    <ZoneCalculatorInner
      tab={tab}
      setTab={setTab}
      ftp={ftp}
      setFtp={setFtp}
      weightKg={weightKg}
      setWeightKg={setWeightKg}
      maxHr={maxHr}
      setMaxHr={setMaxHr}
      restingHr={restingHr}
      setRestingHr={setRestingHr}
      ref1={ref1}
      setRef1={setRef1}
      useSecondRef={useSecondRef}
      setUseSecondRef={setUseSecondRef}
      ref2={ref2}
      setRef2={setRef2}
    />
  );
}

function ZoneCalculatorAnonymous() {
  const [tab, setTab] = React.useState<Tab>("heart-rate");
  const [ftp, setFtp] = React.useState<number | null>(200);
  const [weightKg, setWeightKg] = React.useState<number | null>(75);
  const [maxHr, setMaxHr] = React.useState<number | null>(185);
  const [restingHr, setRestingHr] = React.useState<number | null>(50);

  const [ref1, setRef1] = React.useState<RaceRef>({
    type: "10k",
    hours: 0,
    minutes: 45,
    seconds: 0,
    vma: 15,
  });
  const [useSecondRef, setUseSecondRef] = React.useState(false);
  const [ref2, setRef2] = React.useState<RaceRef>({
    type: "half-marathon",
    hours: 1,
    minutes: 40,
    seconds: 0,
    vma: null,
  });

  return (
    <ZoneCalculatorInner
      tab={tab}
      setTab={setTab}
      ftp={ftp}
      setFtp={setFtp}
      weightKg={weightKg}
      setWeightKg={setWeightKg}
      maxHr={maxHr}
      setMaxHr={setMaxHr}
      restingHr={restingHr}
      setRestingHr={setRestingHr}
      ref1={ref1}
      setRef1={setRef1}
      useSecondRef={useSecondRef}
      setUseSecondRef={setUseSecondRef}
      ref2={ref2}
      setRef2={setRef2}
    />
  );
}

function RaceRefInputFields({
  label,
  value,
  onChange,
  allowVma,
  onRemove,
}: {
  label: string;
  value: RaceRef;
  onChange: (v: RaceRef) => void;
  allowVma: boolean;
  onRemove?: () => void;
}) {
  const options = allowVma
    ? REFERENCE_OPTIONS
    : REFERENCE_OPTIONS.filter((o) => o.id !== "vma");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-foreground text-sm font-medium">{label}</span>
        {onRemove && (
          <Button variant="ghost" size="icon-xs" onClick={onRemove}>
            <XIcon className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Reference type picker */}
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <Button
            key={opt.id}
            variant={value.type === opt.id ? "default" : "outline"}
            size="xs"
            onClick={() => onChange({ ...value, type: opt.id })}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {/* Input fields */}
      {value.type === "vma" ? (
        <div>
          <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
            VMA
          </label>
          <div className="flex items-center gap-1.5">
            <NumberField
              min={8}
              max={30}
              step={0.1}
              value={value.vma}
              onValueChange={(v) => onChange({ ...value, vma: v })}
              className="w-24"
            />
            <span className="text-muted-foreground text-sm">km/h</span>
          </div>
        </div>
      ) : (
        <div>
          <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
            Finish time
          </label>
          <div className="flex items-center gap-1.5">
            <NumberField
              min={0}
              max={23}
              value={value.hours}
              onValueChange={(v) => onChange({ ...value, hours: v })}
              className="w-20"
            />
            <span className="text-muted-foreground font-medium">:</span>
            <NumberField
              min={0}
              max={59}
              value={value.minutes}
              onValueChange={(v) => onChange({ ...value, minutes: v })}
              className="w-20"
            />
            <span className="text-muted-foreground font-medium">:</span>
            <NumberField
              min={0}
              max={59}
              value={value.seconds}
              onValueChange={(v) => onChange({ ...value, seconds: v })}
              className="w-20"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ZoneCalculatorInner({
  tab,
  setTab,
  ftp,
  setFtp,
  weightKg,
  setWeightKg,
  maxHr,
  setMaxHr,
  restingHr,
  setRestingHr,
  ref1,
  setRef1,
  useSecondRef,
  setUseSecondRef,
  ref2,
  setRef2,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  ftp: number | null;
  setFtp: (v: number | null) => void;
  weightKg: number | null;
  setWeightKg: (v: number | null) => void;
  maxHr: number | null;
  setMaxHr: (v: number | null) => void;
  restingHr: number | null;
  setRestingHr: (v: number | null) => void;
  ref1: RaceRef;
  setRef1: (v: RaceRef) => void;
  useSecondRef: boolean;
  setUseSecondRef: (v: boolean) => void;
  ref2: RaceRef;
  setRef2: (v: RaceRef) => void;
}) {
  const vdot1 = React.useMemo(() => getVdotFromRef(ref1), [ref1]);
  const vdot2 = React.useMemo(
    () => (useSecondRef ? getVdotFromRef(ref2) : null),
    [useSecondRef, ref2],
  );

  const finalVdot = React.useMemo(() => {
    if (vdot1 == null) return null;
    if (vdot2 != null) return (vdot1 + vdot2) / 2;
    return vdot1;
  }, [vdot1, vdot2]);

  return (
    <>
      {/* Input Card */}
      <div className="bg-card rounded-xl border p-4 md:p-6">
        {/* Tab toggle */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          <Button
            variant={tab === "heart-rate" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("heart-rate")}
          >
            Heart Rate Zones
          </Button>
          <Button
            variant={tab === "power" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("power")}
          >
            Cycling Power Zones
          </Button>
          <Button
            variant={tab === "running-pace" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("running-pace")}
          >
            Running Pace Zones
          </Button>
        </div>

        {tab === "power" && (
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                FTP
              </label>
              <div className="flex items-center gap-1.5">
                <NumberField
                  min={50}
                  max={600}
                  value={ftp}
                  onValueChange={setFtp}
                  className="w-24"
                />
                <span className="text-muted-foreground text-sm">watts</span>
              </div>
            </div>
            <div>
              <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                Weight (optional)
              </label>
              <div className="flex items-center gap-1.5">
                <NumberField
                  min={30}
                  max={200}
                  value={weightKg}
                  onValueChange={setWeightKg}
                  className="w-24"
                />
                <span className="text-muted-foreground text-sm">kg</span>
              </div>
            </div>
          </div>
        )}

        {tab === "heart-rate" && (
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                Max Heart Rate
              </label>
              <div className="flex items-center gap-1.5">
                <NumberField
                  min={100}
                  max={230}
                  value={maxHr}
                  onValueChange={setMaxHr}
                  className="w-24"
                />
                <span className="text-muted-foreground text-sm">bpm</span>
              </div>
            </div>
            <div>
              <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                Resting Heart Rate
              </label>
              <div className="flex items-center gap-1.5">
                <NumberField
                  min={30}
                  max={120}
                  value={restingHr}
                  onValueChange={setRestingHr}
                  className="w-24"
                />
                <span className="text-muted-foreground text-sm">bpm</span>
              </div>
            </div>
          </div>
        )}

        {tab === "running-pace" && (
          <div className="flex flex-col gap-6">
            <RaceRefInputFields
              label="Reference 1"
              value={ref1}
              onChange={setRef1}
              allowVma
            />

            {useSecondRef ? (
              <div className="border-border border-t pt-6">
                <RaceRefInputFields
                  label="Reference 2"
                  value={ref2}
                  onChange={setRef2}
                  allowVma={false}
                  onRemove={() => setUseSecondRef(false)}
                />
              </div>
            ) : (
              <button
                className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-sm transition-colors"
                onClick={() => setUseSecondRef(true)}
              >
                <PlusIcon className="size-3.5" />
                Add a second reference for more accuracy
              </button>
            )}

            {/* VDOT info */}
            {finalVdot != null && (
              <div className="bg-muted/50 flex items-start gap-2 rounded-lg p-3">
                <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="inline-flex cursor-help items-center gap-1 underline decoration-dotted underline-offset-4">
                            VDOT
                            <InfoIcon className="size-3" />
                          </span>
                        }
                      />
                      <TooltipContent side="top" className="max-w-64">
                        A fitness score from the Jack Daniels formula. It
                        estimates your VO2max adjusted for running economy.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  :{" "}
                  <span className="text-foreground font-medium tabular-nums">
                    {finalVdot.toFixed(1)}
                  </span>
                  {vdot2 != null && vdot1 != null && (
                    <span>
                      {" "}(average of {vdot1.toFixed(1)} and {vdot2.toFixed(1)})
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Zones Table */}
      {tab === "power" && ftp != null && ftp > 0 && (
        <PowerZonesTable ftp={ftp} weightKg={weightKg} />
      )}
      {tab === "heart-rate" && maxHr != null && maxHr > 0 && (
        <HrZonesTable maxHr={maxHr} restingHr={restingHr ?? 0} />
      )}
      {tab === "running-pace" && finalVdot != null && (
        <RunningPaceZonesTable vdot={finalVdot} />
      )}
    </>
  );
}

function PowerZonesTable({
  ftp,
  weightKg,
}: {
  ftp: number;
  weightKg: number | null;
}) {
  const showWkg = weightKg != null && weightKg > 0;

  return (
    <div className="bg-card rounded-xl border">
      <div className="px-4 pt-4 pb-2 md:px-6 md:pt-6">
        <h2 className="text-foreground text-lg font-semibold">
          Power Zones (Coggan)
        </h2>
        <p className="text-muted-foreground text-sm">
          Based on FTP of {ftp}W
          {showWkg && (
            <> — {(ftp / weightKg).toFixed(2)} W/kg</>
          )}
        </p>
      </div>
      <ToolboxTable>
        <ToolboxTableHeader>
          <ToolboxTableHeaderRow>
            <ToolboxTableHead first>Zone</ToolboxTableHead>
            <ToolboxTableHead>Name</ToolboxTableHead>
            <ToolboxTableHead>% FTP</ToolboxTableHead>
            <ToolboxTableHead>Watts</ToolboxTableHead>
            {showWkg && <ToolboxTableHead>W/kg</ToolboxTableHead>}
          </ToolboxTableHeaderRow>
        </ToolboxTableHeader>
        <ToolboxTableBody>
          {POWER_ZONES.map((zone, i) => {
            const prevMax = i === 0 ? 0 : POWER_ZONES[i - 1].maxPct;
            const minW = Math.round(prevMax * ftp);
            const maxW =
              zone.maxPct === Infinity ? null : Math.round(zone.maxPct * ftp);

            const minPctLabel = Math.round(prevMax * 100);
            const maxPctLabel =
              zone.maxPct === Infinity ? null : Math.round(zone.maxPct * 100);

            return (
              <ToolboxTableRow key={zone.name}>
                <ToolboxTableCell first>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-3 rounded-sm"
                      style={{ backgroundColor: zone.color }}
                    />
                    <span>Z{i + 1}</span>
                  </div>
                </ToolboxTableCell>
                <ToolboxTableCell>{zone.name}</ToolboxTableCell>
                <ToolboxTableCell className="text-muted-foreground tabular-nums">
                  {maxPctLabel != null
                    ? `${minPctLabel}–${maxPctLabel}%`
                    : `>${minPctLabel}%`}
                </ToolboxTableCell>
                <ToolboxTableCell className="tabular-nums">
                  {maxW != null ? `${minW}–${maxW}` : `>${minW}`}
                </ToolboxTableCell>
                {showWkg && (
                  <ToolboxTableCell className="text-muted-foreground tabular-nums">
                    {maxW != null
                      ? `${(minW / weightKg).toFixed(1)}–${(maxW / weightKg).toFixed(1)}`
                      : `>${(minW / weightKg).toFixed(1)}`}
                  </ToolboxTableCell>
                )}
              </ToolboxTableRow>
            );
          })}
        </ToolboxTableBody>
      </ToolboxTable>
    </div>
  );
}

function HrZonesTable({
  maxHr,
  restingHr,
}: {
  maxHr: number;
  restingHr: number;
}) {
  // Karvonen formula: target HR = resting + (max - resting) * intensity%
  const hrReserve = maxHr - restingHr;

  return (
    <div className="bg-card rounded-xl border">
      <div className="px-4 pt-4 pb-2 md:px-6 md:pt-6">
        <h2 className="text-foreground text-lg font-semibold">
          Heart Rate Zones (Karvonen)
        </h2>
        <p className="text-muted-foreground text-sm">
          Based on max HR of {maxHr} bpm
          {restingHr > 0 && <> and resting HR of {restingHr} bpm</>}
          {" — "}HR reserve: {hrReserve} bpm
        </p>
      </div>
      <ToolboxTable>
        <ToolboxTableHeader>
          <ToolboxTableHeaderRow>
            <ToolboxTableHead first>Zone</ToolboxTableHead>
            <ToolboxTableHead>Name</ToolboxTableHead>
            <ToolboxTableHead>% HRR</ToolboxTableHead>
            <ToolboxTableHead>BPM</ToolboxTableHead>
          </ToolboxTableHeaderRow>
        </ToolboxTableHeader>
        <ToolboxTableBody>
          {HR_ZONES.map((zone, i) => {
            const minBpm = Math.round(restingHr + hrReserve * zone.minPct);
            const maxBpm = Math.round(restingHr + hrReserve * zone.maxPct);
            const minPctLabel = Math.round(zone.minPct * 100);
            const maxPctLabel = Math.round(zone.maxPct * 100);

            return (
              <ToolboxTableRow key={zone.name}>
                <ToolboxTableCell first>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-3 rounded-sm"
                      style={{ backgroundColor: zone.color }}
                    />
                    <span>Z{i + 1}</span>
                  </div>
                </ToolboxTableCell>
                <ToolboxTableCell>{zone.name}</ToolboxTableCell>
                <ToolboxTableCell className="text-muted-foreground tabular-nums">
                  {minPctLabel}–{maxPctLabel}%
                </ToolboxTableCell>
                <ToolboxTableCell className="tabular-nums">
                  {minBpm}–{maxBpm}
                </ToolboxTableCell>
              </ToolboxTableRow>
            );
          })}
        </ToolboxTableBody>
      </ToolboxTable>
    </div>
  );
}

const RUNNING_ZONES = [
  { name: "Easy", color: "#808080" },
  { name: "Marathon", color: "#3B82F6" },
  { name: "Threshold", color: "#22C55E" },
  { name: "Interval", color: "#EAB308" },
  { name: "Repetition", color: "#EF4444" },
] as const;

interface PaceRange {
  /** Slower pace (higher seconds/km value) */
  slow: number;
  /** Faster pace (lower seconds/km value) */
  fast: number;
}

function computeRunningZones(vdot: number): PaceRange[] {
  // Easy: 59-74% VO2max (slow pace = lower %, fast pace = higher %)
  const easySlow = paceSecondsPerKmFromVdotPct(vdot, 0.59);
  const easyFast = paceSecondsPerKmFromVdotPct(vdot, 0.74);

  // Marathon: predicted marathon race pace (± ~5 sec/km range)
  const marathonTimeMin = predictRaceTime(vdot, 42195);
  const marathonPace = (marathonTimeMin * 60) / 42.195; // seconds/km
  const marathonSlow = marathonPace + 5;
  const marathonFast = marathonPace - 5;

  // Threshold: 83-88% VO2max
  const thresholdSlow = paceSecondsPerKmFromVdotPct(vdot, 0.83);
  const thresholdFast = paceSecondsPerKmFromVdotPct(vdot, 0.88);

  // Interval: 95-100% VO2max
  const intervalSlow = paceSecondsPerKmFromVdotPct(vdot, 0.95);
  const intervalFast = paceSecondsPerKmFromVdotPct(vdot, 1.0);

  // Repetition: Interval pace minus 15s/km (VDOT >= 50) or 20s/km (VDOT < 50)
  const repOffset = vdot >= 50 ? 15 : 20;
  const repSlow = intervalFast - repOffset + 5;
  const repFast = intervalFast - repOffset - 5;

  return [
    { slow: easySlow, fast: easyFast },
    { slow: marathonSlow, fast: marathonFast },
    { slow: thresholdSlow, fast: thresholdFast },
    { slow: intervalSlow, fast: intervalFast },
    { slow: repSlow, fast: repFast },
  ];
}

function RunningPaceZonesTable({ vdot }: { vdot: number }) {
  const zones = React.useMemo(() => computeRunningZones(vdot), [vdot]);

  return (
    <div className="bg-card rounded-xl border">
      <div className="px-4 pt-4 pb-2 md:px-6 md:pt-6">
        <h2 className="text-foreground text-lg font-semibold">
          Running Pace Zones (Daniels)
        </h2>
        <p className="text-muted-foreground text-sm">
          Based on VDOT of {vdot.toFixed(1)}
        </p>
      </div>
      <ToolboxTable>
        <ToolboxTableHeader>
          <ToolboxTableHeaderRow>
            <ToolboxTableHead first>Zone</ToolboxTableHead>
            <ToolboxTableHead>Pace /km</ToolboxTableHead>
            <ToolboxTableHead>Speed</ToolboxTableHead>
          </ToolboxTableHeaderRow>
        </ToolboxTableHeader>
        <ToolboxTableBody>
          {RUNNING_ZONES.map((zone, i) => {
            const range = zones[i];
            const slowKmh = (3600 / range.slow).toFixed(1);
            const fastKmh = (3600 / range.fast).toFixed(1);

            return (
              <ToolboxTableRow key={zone.name}>
                <ToolboxTableCell first>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-3 rounded-sm"
                      style={{ backgroundColor: zone.color }}
                    />
                    <span>{zone.name}</span>
                  </div>
                </ToolboxTableCell>
                <ToolboxTableCell className="tabular-nums">
                  {formatMinutesSeconds(range.fast)}–
                  {formatMinutesSeconds(range.slow)}
                </ToolboxTableCell>
                <ToolboxTableCell className="text-muted-foreground tabular-nums">
                  {slowKmh}–{fastKmh} km/h
                </ToolboxTableCell>
              </ToolboxTableRow>
            );
          })}
        </ToolboxTableBody>
      </ToolboxTable>
    </div>
  );
}
