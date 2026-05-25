import * as React from "react";

import { InfoIcon, PlusIcon, XIcon } from "lucide-react";

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
  { label: "1 km", km: 1 },
  { label: "1 mile", km: 1.60934 },
  { label: "5 km", km: 5 },
  { label: "10 km", km: 10 },
  { label: "Half Marathon", km: 21.0975 },
  { label: "Marathon", km: 42.195 },
  { label: "50 km", km: 50 },
  { label: "100 km", km: 100 },
] as const;

const DEFAULT_RIEGEL_EXPONENT = 1.06;

interface RaceInput {
  distanceLabel: string;
  customKm: number | null;
  hours: number | null;
  minutes: number | null;
  seconds: number | null;
}

function getDistanceKm(input: RaceInput): number | null {
  if (input.distanceLabel === "Custom") {
    return input.customKm;
  }
  return DISTANCES.find((d) => d.label === input.distanceLabel)?.km ?? null;
}

function getTotalSeconds(input: RaceInput): number | null {
  const total =
    (input.hours ?? 0) * 3600 +
    (input.minutes ?? 0) * 60 +
    (input.seconds ?? 0);
  return total > 0 ? total : null;
}

interface Model {
  a: number;
  b: number;
  personalized: boolean;
  warning: string | null;
}

function computeModel(
  race1Km: number,
  race1Sec: number,
  race2Km: number | null,
  race2Sec: number | null,
): Model | null {
  if (race1Km <= 0 || race1Sec <= 0) return null;

  // Two-point fit: solve for personal exponent
  if (race2Km != null && race2Sec != null && race2Km > 0 && race2Sec > 0) {
    // Avoid identical distances — fall back to Riegel
    if (Math.abs(race1Km - race2Km) < 0.01) {
      const b = DEFAULT_RIEGEL_EXPONENT;
      const a = race1Sec / Math.pow(race1Km, b);
      return {
        a,
        b,
        personalized: false,
        warning: "Both races have the same distance. Using default formula.",
      };
    }

    const b = Math.log(race2Sec / race1Sec) / Math.log(race2Km / race1Km);

    // Sanity check — fall back to Riegel with warning
    if (b < 0.9 || b > 1.3) {
      const bFallback = DEFAULT_RIEGEL_EXPONENT;
      const a = race1Sec / Math.pow(race1Km, bFallback);
      return {
        a,
        b: bFallback,
        personalized: false,
        warning:
          "The two results seem inconsistent. Using default formula instead.",
      };
    }

    const a = race1Sec / Math.pow(race1Km, b);
    return { a, b, personalized: true, warning: null };
  }

  // Single-point: use Riegel default exponent
  const b = DEFAULT_RIEGEL_EXPONENT;
  const a = race1Sec / Math.pow(race1Km, b);
  return { a, b, personalized: false, warning: null };
}

function predictTime(model: { a: number; b: number }, km: number): number {
  return model.a * Math.pow(km, model.b);
}

function RaceInputFields({
  label,
  value,
  onChange,
}: {
  label?: string;
  value: RaceInput;
  onChange: (v: RaceInput) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {label && (
        <span className="text-foreground text-sm font-medium">{label}</span>
      )}

      {/* Distance picker */}
      <div>
        <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
          Distance
        </label>
        <div className="flex flex-wrap gap-1.5">
          {[...DISTANCES, { label: "Custom" as const, km: null }].map((d) => (
            <Button
              key={d.label}
              variant={value.distanceLabel === d.label ? "default" : "outline"}
              size="xs"
              onClick={() => onChange({ ...value, distanceLabel: d.label })}
            >
              {d.label}
            </Button>
          ))}
        </div>
        {value.distanceLabel === "Custom" && (
          <div className="mt-2 flex items-center gap-1.5">
            <NumberField
              min={0.1}
              step={0.1}
              value={value.customKm}
              onValueChange={(v) => onChange({ ...value, customKm: v })}
              className="w-24"
            />
            <span className="text-muted-foreground text-sm">km</span>
          </div>
        )}
      </div>

      {/* Time input */}
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
    </div>
  );
}

export function RacePredictor() {
  const [useSecondRace, setUseSecondRace] = React.useState(false);

  const [race1, setRace1] = React.useState<RaceInput>({
    distanceLabel: "10 km",
    customKm: null,
    hours: 0,
    minutes: 45,
    seconds: 0,
  });

  const [race2, setRace2] = React.useState<RaceInput>({
    distanceLabel: "Half Marathon",
    customKm: null,
    hours: 1,
    minutes: 40,
    seconds: 0,
  });

  const race1Km = getDistanceKm(race1);
  const race1Sec = getTotalSeconds(race1);
  const race2Km = useSecondRace ? getDistanceKm(race2) : null;
  const race2Sec = useSecondRace ? getTotalSeconds(race2) : null;

  const model = React.useMemo(
    () =>
      race1Km != null && race1Sec != null
        ? computeModel(race1Km, race1Sec, race2Km, race2Sec)
        : null,
    [race1Km, race1Sec, race2Km, race2Sec],
  );

  return (
    <div className="divide-border border-border flex w-full flex-col divide-y border-b md:mx-auto md:max-w-3xl md:gap-6 md:divide-y-0 md:border-0">
      {/* Input Card */}
      <div className="md:border-border md:bg-card p-4 md:rounded-sm md:border md:p-6">
        <div className="flex flex-col gap-6">
          <RaceInputFields label="Race 1" value={race1} onChange={setRace1} />

          {useSecondRace ? (
            <div className="border-border border-t pt-6">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-foreground text-sm font-medium">
                  Race 2
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setUseSecondRace(false)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
              <RaceInputFields value={race2} onChange={setRace2} />
            </div>
          ) : (
            <button
              className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-sm transition-colors"
              onClick={() => setUseSecondRace(true)}
            >
              <PlusIcon className="size-3.5" />
              Add a second race for personalized predictions
            </button>
          )}
        </div>

        {/* Model info */}
        {model && (
          <div className="bg-muted/50 mt-4 flex items-start gap-2 rounded-lg p-3">
            <InfoIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="text-muted-foreground text-sm">
              {model.warning ? (
                <span>{model.warning}</span>
              ) : model.personalized ? (
                <>
                  Personal fatigue factor:{" "}
                  <span className="text-foreground font-medium tabular-nums">
                    {model.b.toFixed(3)}
                  </span>
                  {model.b < 1.05 ? (
                    <span> — speed-oriented profile</span>
                  ) : model.b > 1.07 ? (
                    <span> — endurance-oriented profile</span>
                  ) : (
                    <span> — balanced profile</span>
                  )}
                </>
              ) : (
                <>
                  Using Riegel&apos;s default fatigue factor (1.06). Add a
                  second race for a personalized model.
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Predictions Table */}
      {model && (
        <div className="md:border-border md:bg-card md:rounded-sm md:border">
          <div className="px-4 pt-4 pb-2 md:px-6 md:pt-6">
            <h2 className="text-foreground text-lg font-semibold">
              Predicted Race Times
            </h2>
            <p className="text-muted-foreground text-sm">
              {model.personalized
                ? "Based on your personalized fatigue curve"
                : "Based on Riegel's formula (T₂ = T₁ × (D₂/D₁)^1.06)"}
            </p>
          </div>
          <ToolboxTable>
            <ToolboxTableHeader>
              <ToolboxTableHeaderRow>
                <ToolboxTableHead first>Distance</ToolboxTableHead>
                <ToolboxTableHead>Predicted Time</ToolboxTableHead>
                <ToolboxTableHead>Pace</ToolboxTableHead>
              </ToolboxTableHeaderRow>
            </ToolboxTableHeader>
            <ToolboxTableBody>
              {DISTANCES.map((d) => {
                const predicted = predictTime(model, d.km);
                const pacePerKm = predicted / d.km;
                const isInput =
                  (race1Km != null && Math.abs(d.km - race1Km) < 0.01) ||
                  (model.personalized &&
                    race2Km != null &&
                    Math.abs(d.km - race2Km) < 0.01);

                return (
                  <ToolboxTableRow key={d.label}>
                    <ToolboxTableCell first>
                      {d.label}
                      {isInput && (
                        <span className="text-muted-foreground ml-1.5 text-xs">
                          (input)
                        </span>
                      )}
                    </ToolboxTableCell>
                    <ToolboxTableCell className="tabular-nums">
                      {formatDuration(predicted)}
                    </ToolboxTableCell>
                    <ToolboxTableCell className="text-muted-foreground tabular-nums">
                      {formatMinutesSeconds(pacePerKm)} /km
                    </ToolboxTableCell>
                  </ToolboxTableRow>
                );
              })}
            </ToolboxTableBody>
          </ToolboxTable>
        </div>
      )}
    </div>
  );
}
