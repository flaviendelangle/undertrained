import * as React from "react";

import { type LucideIcon, SlidersHorizontalIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { NumberField } from "~/components/ui/number-field";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverHeader,
  ResponsivePopoverTitle,
  ResponsivePopoverTrigger,
} from "~/components/ui/responsive-popover";
import {
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Select as ShadSelect,
} from "~/components/ui/select";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";

import type { SliceWidthStore } from "./createSliceWidthStore";
import { CHART_SPANS, type ChartSpan } from "./viewChartSettings";

const SPAN_LABEL_KEYS = {
  all: "charts.timeSpan.all",
  "7d": "charts.timeSpan.last7Days",
  "30d": "charts.timeSpan.last30Days",
  "90d": "charts.timeSpan.last90Days",
  "1y": "charts.timeSpan.lastYear",
} as const satisfies Record<ChartSpan, string>;

/** The label of a chart's time span, as its select shows it. */
export function useChartSpanLabel() {
  const t = useT();
  return React.useCallback((span: ChartSpan) => t(SPAN_LABEL_KEYS[span]), [t]);
}

/** A series' colour dot, hollow when the series has nothing to plot. */
export function Swatch({
  color,
  empty = false,
}: {
  color: string;
  empty?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        empty && "border",
      )}
      style={empty ? { borderColor: color } : { backgroundColor: color }}
    />
  );
}

/**
 * A select drawn as a chip, sized to sit among a chart's legend chips or next
 * to its title.
 */
export function ChipSelect<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  swatch,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
  /** The colour of the series the choice plots, when it plots one. */
  swatch?: React.ReactNode;
}) {
  return (
    <ShadSelect
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className="bg-muted hover:bg-muted/70 dark:bg-muted dark:hover:bg-muted/70 h-7 gap-1.5 rounded-full border-transparent px-2.5 py-1 text-xs shadow-none data-[size=default]:h-7"
      >
        {swatch}
        <SelectValue>
          {(selected: T) =>
            options.find((option) => option.value === selected)?.label
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </ShadSelect>
  );
}

/** How far back a chart looks inside the selection. */
export function ChartSpanSelect({
  value,
  onValueChange,
  swatch,
}: {
  value: ChartSpan;
  onValueChange: (span: ChartSpan) => void;
  swatch?: React.ReactNode;
}) {
  const t = useT();
  const spanLabel = useChartSpanLabel();
  return (
    <ChipSelect
      value={value}
      onValueChange={onValueChange}
      options={CHART_SPANS.map((span) => ({
        value: span,
        label: spanLabel(span),
      }))}
      ariaLabel={t("charts.timeSpan.label")}
      swatch={swatch}
    />
  );
}

/** An icon-only tab option for a chart card's `SegmentedToggle`. */
export function iconTabOption<T extends string>(
  value: T,
  Icon: LucideIcon,
  label: string,
) {
  return {
    value,
    tooltip: label,
    label: (
      <>
        <Icon className="size-4" />
        <span className="sr-only">{label}</span>
      </>
    ),
  };
}

/** The sliders button opening the active tab's parameters in a chart card. */
export function ChartSettingsPopover({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <ResponsivePopover>
      <ResponsivePopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground size-6"
            aria-label={label}
          >
            <SlidersHorizontalIcon className="size-4" />
          </Button>
        }
      />
      <ResponsivePopoverContent
        align="end"
        className="flex flex-col gap-4 sm:w-72"
      >
        {children}
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

/** Distribution-tab parameter: the histogram slice width. */
export function SliceWidthSettings({
  store,
  title,
  label,
  hint,
}: {
  store: SliceWidthStore;
  title: string;
  label: string;
  hint: string;
}) {
  const [sliceWidth, setSliceWidth] = store.useSliceWidth();
  return (
    <>
      <ResponsivePopoverHeader>
        <ResponsivePopoverTitle>{title}</ResponsivePopoverTitle>
      </ResponsivePopoverHeader>
      <div className="flex flex-col gap-1.5">
        <Label>{label}</Label>
        <NumberField
          className="w-full"
          value={sliceWidth}
          onValueChange={(value) => {
            if (value != null) setSliceWidth(value);
          }}
          min={store.min}
          max={store.max}
          step={5}
          smallStep={1}
        />
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
    </>
  );
}
