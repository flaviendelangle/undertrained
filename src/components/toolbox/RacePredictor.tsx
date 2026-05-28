import * as React from "react";

import { InfoIcon, PlusIcon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { NumberField } from "~/components/ui/number-field";
import { type TFunction } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
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
  { id: "1km", labelKey: "toolbox.distance.1km", km: 1 },
  { id: "1mile", labelKey: "toolbox.distance.1mile", km: 1.60934 },
  { id: "5k", labelKey: "toolbox.distance.5k", km: 5 },
  { id: "10k", labelKey: "toolbox.distance.10k", km: 10 },
  { id: "half-marathon", labelKey: "toolbox.distance.halfMarathon", km: 21.0975 },
  { id: "marathon", labelKey: "toolbox.distance.marathon", km: 42.195 },
  { id: "50km", labelKey: "toolbox.distance.50km", km: 50 },
  { id: "100km", labelKey: "toolbox.distance.100km", km: 100 },
] as const;

const createDistances = (t: TFunction) =>
  DISTANCES.map((d) => ({ ...d, label: t(d.labelKey) }));

const DEFAULT_RIEGEL_EXPONENT = 1.06;

interface RaceInput {
  distanceId: string;
  customKm: number | null;
  hours: number | null;
  minutes: number | null;
  seconds: number | null;
}

function getDistanceKm(input: RaceInput): number | null {
  if (input.distanceId === "custom") {
    return input.customKm;
  }
  return DISTANCES.find((d) => d.id === input.distanceId)?.km ?? null;
}

function getTotalSeconds(input: RaceInput): number | null {
  const total =
    (input.hours ?? 0) * 3600 +
    (input.minutes ?? 0) * 60 +
    (input.seconds ?? 0);
  return total > 0 ? total : null;
}

type WarningKey = "sameDistance" | "inconsistent";

interface Model {
  a: number;
  b: number;
  personalized: boolean;
  warning: WarningKey | null;
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
        warning: "sameDistance",
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
        warning: "inconsistent",
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
  t,
  distances,
  label,
  value,
  onChange,
}: {
  t: TFunction;
  distances: { id: string; label: string }[];
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
          {t("toolbox.distance.label")}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {[
            ...distances,
            { id: "custom", label: t("toolbox.distance.custom") },
          ].map((d) => (
            <Button
              key={d.id}
              variant={value.distanceId === d.id ? "default" : "outline"}
              size="xs"
              onClick={() => onChange({ ...value, distanceId: d.id })}
            >
              {d.label}
            </Button>
          ))}
        </div>
        {value.distanceId === "custom" && (
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
          {t("toolbox.finishTime")}
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
  const t = useT();
  const distances = React.useMemo(() => createDistances(t), [t]);

  const [useSecondRace, setUseSecondRace] = React.useState(false);

  const [race1, setRace1] = React.useState<RaceInput>({
    distanceId: "10k",
    customKm: null,
    hours: 0,
    minutes: 45,
    seconds: 0,
  });

  const [race2, setRace2] = React.useState<RaceInput>({
    distanceId: "half-marathon",
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
          <RaceInputFields
            t={t}
            distances={distances}
            label={t("toolbox.racePredictor.race1")}
            value={race1}
            onChange={setRace1}
          />

          {useSecondRace ? (
            <div className="border-border border-t pt-6">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-foreground text-sm font-medium">
                  {t("toolbox.racePredictor.race2")}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setUseSecondRace(false)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
              <RaceInputFields
                t={t}
                distances={distances}
                value={race2}
                onChange={setRace2}
              />
            </div>
          ) : (
            <button
              className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-sm transition-colors"
              onClick={() => setUseSecondRace(true)}
            >
              <PlusIcon className="size-3.5" />
              {t("toolbox.racePredictor.addSecondRace")}
            </button>
          )}
        </div>

        {/* Model info */}
        {model && (
          <div className="bg-muted/50 mt-4 flex items-start gap-2 rounded-lg p-3">
            <InfoIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="text-muted-foreground text-sm">
              {model.warning ? (
                <span>
                  {model.warning === "sameDistance"
                    ? t("toolbox.racePredictor.warningSameDistance")
                    : t("toolbox.racePredictor.warningInconsistent")}
                </span>
              ) : model.personalized ? (
                <>
                  {t("toolbox.racePredictor.fatigueFactor")}{" "}
                  <span className="text-foreground font-medium tabular-nums">
                    {model.b.toFixed(3)}
                  </span>
                  {model.b < 1.05 ? (
                    <span> {t("toolbox.racePredictor.profileSpeed")}</span>
                  ) : model.b > 1.07 ? (
                    <span> {t("toolbox.racePredictor.profileEndurance")}</span>
                  ) : (
                    <span> {t("toolbox.racePredictor.profileBalanced")}</span>
                  )}
                </>
              ) : (
                <>{t("toolbox.racePredictor.defaultModel")}</>
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
              {t("toolbox.racePredictor.tableTitle")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {model.personalized
                ? t("toolbox.racePredictor.basedOnPersonalized")
                : t("toolbox.racePredictor.basedOnRiegel")}
            </p>
          </div>
          <ToolboxTable>
            <ToolboxTableHeader>
              <ToolboxTableHeaderRow>
                <ToolboxTableHead first>
                  {t("toolbox.distance.label")}
                </ToolboxTableHead>
                <ToolboxTableHead>
                  {t("toolbox.racePredictor.predictedTime")}
                </ToolboxTableHead>
                <ToolboxTableHead>{t("toolbox.pace.pace")}</ToolboxTableHead>
              </ToolboxTableHeaderRow>
            </ToolboxTableHeader>
            <ToolboxTableBody>
              {distances.map((d) => {
                const predicted = predictTime(model, d.km);
                const pacePerKm = predicted / d.km;
                const isInput =
                  (race1Km != null && Math.abs(d.km - race1Km) < 0.01) ||
                  (model.personalized &&
                    race2Km != null &&
                    Math.abs(d.km - race2Km) < 0.01);

                return (
                  <ToolboxTableRow key={d.id}>
                    <ToolboxTableCell first>
                      {d.label}
                      {isInput && (
                        <span className="text-muted-foreground ml-1.5 text-xs">
                          {t("toolbox.racePredictor.input")}
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
