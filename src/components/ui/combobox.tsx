"use client";

import * as React from "react";

import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";

import { cn } from "~/lib/utils";

const Combobox = ComboboxPrimitive.Root;

function ComboboxValue(props: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value {...props} />;
}

function ComboboxTrigger({
  className,
  size = "default",
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props & {
  size?: "sm" | "default";
}) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      data-size={size}
      className={cn(
        "border-input data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 flex w-fit items-center justify-between gap-1.5 rounded-md border bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=combobox-value]:line-clamp-1 *:data-[slot=combobox-value]:flex *:data-[slot=combobox-value]:items-center *:data-[slot=combobox-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.Icon
        render={
          <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4" />
        }
      />
    </ComboboxPrimitive.Trigger>
  );
}

/** Search input rendered inside the popup. */
function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <div className="border-border flex items-center gap-2 border-b px-3">
      <SearchIcon className="text-muted-foreground size-4 shrink-0" />
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        className={cn(
          "placeholder:text-muted-foreground flex h-9 w-full bg-transparent py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function ComboboxContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, "side" | "sideOffset" | "align">) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        className="isolate z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-md shadow-md ring-1 duration-100",
            className,
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn("max-h-72 scroll-py-1 overflow-y-auto p-1", className)}
      {...props}
    />
  );
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "text-muted-foreground px-2 py-6 text-center text-sm empty:m-0 empty:p-0",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      data-slot="combobox-group"
      className={cn("scroll-my-1", className)}
      {...props}
    />
  );
}

function ComboboxGroupLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-group-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  );
}

const ComboboxCollection = ComboboxPrimitive.Collection;

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

export {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
};
