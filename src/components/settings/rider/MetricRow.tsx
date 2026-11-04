import { useEffect, useId, useRef, useState } from "react";

import { format, parseISO } from "date-fns";
import { ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";

import { Collapsible } from "@base-ui/react/collapsible";

import { Quantity } from "~/components/primitives/Quantity";
import { Button } from "~/components/ui/button";
import { NumberField } from "~/components/ui/number-field";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { useLocale, useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import {
  DEFAULT_RIDER_SETTINGS_TIMELINE,
  type RiderSettingsTimeline,
} from "~/sensors/types";

import { PaceInput } from "../PaceInput";
import {
  type RiderFieldConfig,
  formatFieldDelta,
  formatFieldValue,
} from "../fieldConfig";
import {
  deleteField,
  getFieldHistory,
  setBaselineField,
  setField,
} from "../timelineEdits";
import { EditableValue } from "./EditableValue";

const DEFAULTS = DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues;

// Lazy-load the sparkline so @mui/x-charts-pro stays out of the Settings entry
// chunk — it only renders for fields that have actually changed over time.
const MetricSparkline = dynamic(
  () => import("./MetricSparkline").then((m) => m.MetricSparkline),
  { ssr: false },
);

/**
 * The columns every row of the profile table shares, so a metric's history
 * lines up under its summary: name, value, since, change, disclosure. Under
 * `lg` only the name, the value and the last column remain.
 */
export const METRIC_ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto_1.5rem] items-center gap-x-4 max-lg:pointer-coarse:grid-cols-[minmax(0,1fr)_auto_2.5rem] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_1.5rem]";

function formatDay(date: string): string {
  return format(parseISO(date), "d MMM yyyy", {
    locale: getActiveDateLocale(),
  });
}

interface MetricRowProps {
  config: RiderFieldConfig;
  timeline: RiderSettingsTimeline;
  onTimelineChange: (timeline: RiderSettingsTimeline) => void;
  hasSettings: boolean;
}

/**
 * One metric of the athlete profile: its value in force, since when, how far
 * it moved from the start value, and a disclosure with the dated history where
 * values are edited, added and deleted.
 */
export function MetricRow({
  config,
  timeline,
  onTimelineChange,
  hasSettings,
}: MetricRowProps) {
  const t = useT();
  const summaryId = useId();
  const field = config.field;
  const history = getFieldHistory(timeline, field);
  const changes = history.filter((entry) => !entry.isBaseline);
  const latest = changes.at(-1);

  const startValue = hasSettings ? timeline.initialValues[field] : null;
  const current = hasSettings ? (latest?.value ?? startValue) : null;
  const isDefault = current == null;
  const shownValue = current ?? DEFAULTS[field];
  // Before its first change a metric is at its start value, or the default.
  const change = latest
    ? formatFieldDelta(config, startValue ?? DEFAULTS[field], latest.value!)
    : null;

  const since = latest
    ? formatDay(latest.date!)
    : isDefault
      ? t("settings.metric.default")
      : t("settings.metric.start");

  return (
    <Collapsible.Root className="group/metric border-border/60 border-t">
      <div
        className={cn(
          METRIC_ROW_GRID,
          "hover:bg-accent/40 relative -mx-5 px-5 py-3 transition-colors",
        )}
      >
        <div className="min-w-0">
          <Collapsible.Trigger
            aria-describedby={`${summaryId}-value ${summaryId}-since ${summaryId}-change`}
            className="focus-visible:ring-ring cursor-pointer rounded-sm text-left text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:ring-2"
          >
            {t(config.labelKey)}
          </Collapsible.Trigger>
          <div
            aria-hidden="true"
            className="text-muted-foreground mt-0.5 text-xs lg:hidden"
          >
            {latest
              ? t("settings.metric.sinceDate", {
                  date: formatDay(latest.date!),
                })
              : since}
          </div>
        </div>
        {/* Screen readers read these after the metric's name
            (aria-describedby), each with the column it sits in. */}
        <div
          id={`${summaryId}-value`}
          className={cn(
            "text-right text-lg leading-tight font-semibold whitespace-nowrap tabular-nums lg:text-left",
            isDefault && "text-muted-foreground",
          )}
        >
          <Quantity text={formatFieldValue(config, shownValue)} />
        </div>
        <div
          id={`${summaryId}-since`}
          className={cn(
            "truncate text-sm max-lg:hidden",
            latest ? "text-foreground/80" : "text-muted-foreground",
          )}
        >
          {latest && (
            <span className="sr-only">
              {t("settings.metric.column.since")}{" "}
            </span>
          )}
          {since}
        </div>
        <div
          id={`${summaryId}-change`}
          className="text-muted-foreground flex items-center gap-3 text-sm tabular-nums max-lg:hidden"
        >
          {/* The history's rows compare with the previous value: the total
              since the start steps aside while they show. */}
          {change && (
            <span className="w-14 shrink-0 group-data-open/metric:invisible">
              <span className="sr-only">
                {t("settings.metric.changeSinceStart")}{" "}
              </span>
              {change}
            </span>
          )}
          <MetricSparkline
            timeline={timeline}
            field={field}
            className="w-20 shrink-0"
          />
        </div>
        <ChevronRightIcon
          aria-hidden="true"
          className="text-muted-foreground size-4 justify-self-end transition-transform group-data-open/metric:rotate-90"
        />
      </div>

      <Collapsible.Panel>
        <MetricHistory
          config={config}
          timeline={timeline}
          onTimelineChange={onTimelineChange}
          hasSettings={hasSettings}
        />
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

/**
 * A history row on the profile table's columns: on `lg` the value, its date
 * and its change sit under the Value, Since and Change headers; below `lg`,
 * the date leads and the value follows.
 */
const HISTORY_ROW =
  "grid min-h-9 grid-cols-[minmax(0,1fr)_auto_1.5rem] items-center gap-x-4 py-0.5 pointer-coarse:min-h-11 max-lg:pointer-coarse:grid-cols-[minmax(0,1fr)_auto_2.5rem] lg:col-span-4 lg:grid-cols-subgrid";

/**
 * The dated values of one metric, newest first, above its start value, with
 * what the metric is for alongside.
 */
function MetricHistory({
  config,
  timeline,
  onTimelineChange,
  hasSettings,
}: MetricRowProps) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  // Where focus goes once the row holding it is gone: the next row's delete
  // button (by change id) or the start value. Applied after the re-render.
  const focusAfterDelete = useRef<string | null>(null);
  // Set when the add form closes, so its trigger regains focus.
  const restoreAddFocus = useRef(false);
  const field = config.field;
  const label = t(config.labelKey);
  const history = getFieldHistory(timeline, field);
  const changes = history.filter((entry) => !entry.isBaseline);
  const startValue = hasSettings ? timeline.initialValues[field] : null;

  // Newest first; each change is compared with the value it replaced.
  const rows = changes
    .map((entry, index) => {
      const previous =
        index === 0
          ? (startValue ?? DEFAULTS[field])
          : changes[index - 1].value!;
      return { entry, delta: formatFieldDelta(config, previous, entry.value!) };
    })
    .reverse();

  useEffect(() => {
    const key = focusAfterDelete.current;
    if (key == null) return;
    focusAfterDelete.current = null;
    const target = listRef.current?.querySelector<HTMLElement>(
      `[data-focus-key="${key}"]`,
    );
    (target?.matches("button")
      ? target
      : target?.querySelector<HTMLElement>("button")
    )?.focus();
  });

  const closeAddForm = () => {
    restoreAddFocus.current = true;
    setAdding(false);
  };

  return (
    <div className={cn(METRIC_ROW_GRID, "items-start pb-3")}>
      <p className="text-muted-foreground col-span-3 pb-2 text-xs leading-relaxed lg:col-span-1 lg:row-span-2 lg:pt-2.5 lg:pb-0">
        {config.tooltipKey && <>{t(config.tooltipKey)} </>}
        {t("settings.metric.historyHint")}
      </p>

      <ul
        ref={listRef}
        className="col-span-3 text-sm lg:col-span-4 lg:col-start-2 lg:grid lg:grid-cols-subgrid"
      >
        {rows.map(({ entry, delta }, index) => {
          const day = formatDay(entry.date!);
          return (
            <li key={entry.id} className={HISTORY_ROW}>
              <EditableValue
                config={config}
                value={entry.value}
                name={`${label}, ${day}`}
                onCommit={(value) => {
                  // Clearing a dated value removes its row, like delete.
                  if (value == null) {
                    focusAfterDelete.current =
                      rows[index + 1]?.entry.id ?? "start";
                  }
                  onTimelineChange(
                    setField(timeline, field, entry.date!, value),
                  );
                }}
                displayClassName="font-medium tabular-nums max-lg:justify-self-end lg:-ml-1"
              />
              <span className="text-muted-foreground truncate max-lg:order-first">
                {day}
              </span>
              <span className="text-muted-foreground tabular-nums max-lg:hidden">
                {delta && (
                  <span className="sr-only">
                    {t("settings.metric.changeFromPrevious")}{" "}
                  </span>
                )}
                {delta}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                data-focus-key={entry.id}
                aria-label={t("settings.metric.deleteValue", { date: day })}
                className="text-muted-foreground hover:text-destructive justify-self-end pointer-coarse:size-10"
                onClick={() => {
                  focusAfterDelete.current =
                    rows[index + 1]?.entry.id ?? "start";
                  onTimelineChange(deleteField(timeline, field, entry.date!));
                }}
              >
                <XIcon />
              </Button>
            </li>
          );
        })}

        <li className={HISTORY_ROW} data-focus-key="start">
          <EditableValue
            config={config}
            value={startValue}
            placeholderValue={DEFAULTS[field]}
            name={`${label}, ${t("settings.metric.start")}`}
            onCommit={(value) =>
              onTimelineChange(setBaselineField(timeline, field, value))
            }
            displayClassName="font-medium tabular-nums max-lg:justify-self-end lg:-ml-1"
          />
          <span className="text-muted-foreground truncate max-lg:order-first lg:col-span-2">
            {startValue == null
              ? t("settings.metric.startDefault")
              : t("settings.metric.start")}
          </span>
        </li>
      </ul>

      <div className="col-span-3 pt-1 lg:col-span-4 lg:col-start-2 lg:grid lg:grid-cols-subgrid">
        {adding ? (
          <AddValueRow
            config={config}
            existingDates={changes.map((entry) => entry.date!)}
            onCancel={closeAddForm}
            onAdd={(date, value) => {
              onTimelineChange(setField(timeline, field, date, value));
              closeAddForm();
            }}
          />
        ) : (
          <Button
            ref={(node) => {
              if (node && restoreAddFocus.current) {
                restoreAddFocus.current = false;
                node.focus();
              }
            }}
            size="xs"
            variant="ghost"
            className="text-muted-foreground -ml-2 justify-self-start pointer-coarse:h-10"
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
            {t("settings.metric.logValue")}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A dated value being added: the value under the Value header, its date under
 * Since, then confirm or cancel. Opens with the value focused; Escape cancels.
 */
function AddValueRow({
  config,
  existingDates,
  onAdd,
  onCancel,
}: {
  config: RiderFieldConfig;
  existingDates: readonly string[];
  onAdd: (date: string, value: number) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [value, setValue] = useState<number | null>(null);
  const replaces = existingDates.includes(date);
  const label = t(config.labelKey);
  const canAdd = value != null && date !== "";
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.querySelector("input")?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (
          event.key === "Enter" &&
          canAdd &&
          !(event.target instanceof HTMLButtonElement)
        ) {
          event.preventDefault();
          onAdd(date, value);
        }
      }}
      className="flex flex-wrap items-center gap-2 py-1 lg:col-span-4 lg:grid lg:grid-cols-subgrid lg:gap-x-4"
    >
      {config.inputType === "pace" && config.paceUnit ? (
        <PaceInput
          value={value}
          paceUnit={config.paceUnit}
          label={label}
          onChange={setValue}
        />
      ) : (
        <NumberField
          value={value}
          onValueChange={setValue}
          min={config.min}
          step={config.step}
          smallStep={config.smallStep}
          locale={locale}
          className="w-28"
          aria-label={label}
        />
      )}
      <input
        type="date"
        value={date}
        aria-label={t("settings.metric.effectiveDate")}
        onChange={(event) => setDate(event.target.value)}
        className="border-input bg-background focus-visible:ring-ring/50 h-8 w-fit rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
      />
      <div className="flex items-center gap-2 lg:col-span-2">
        <Button
          size="sm"
          disabled={!canAdd}
          onClick={() => {
            if (canAdd) onAdd(date, value);
          }}
        >
          {replaces ? t("settings.metric.replace") : t("settings.metric.add")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
