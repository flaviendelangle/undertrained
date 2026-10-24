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

import type { SliceWidthStore } from "./createSliceWidthStore";

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
