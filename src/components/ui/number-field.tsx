"use client";

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";

import { cn } from "~/lib/utils";

function NumberFieldRoot({
  className,
  ...props
}: NumberFieldPrimitive.Root.Props) {
  return (
    <NumberFieldPrimitive.Root
      data-slot="number-field"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

function NumberFieldGroup({
  className,
  ...props
}: NumberFieldPrimitive.Group.Props) {
  return (
    <NumberFieldPrimitive.Group
      data-slot="number-field-group"
      className={cn(
        "border-input bg-background flex items-center rounded-md border shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

function NumberFieldInput({
  className,
  ...props
}: NumberFieldPrimitive.Input.Props) {
  return (
    <NumberFieldPrimitive.Input
      data-slot="number-field-input"
      className={cn(
        "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-w-0 flex-1 border-none bg-transparent px-3 py-1.5 text-sm outline-none focus-visible:ring-3",
        className,
      )}
      {...props}
    />
  );
}

function NumberFieldIncrement({
  className,
  ...props
}: NumberFieldPrimitive.Increment.Props) {
  return (
    <NumberFieldPrimitive.Increment
      data-slot="number-field-increment"
      className={cn(
        "hover:bg-muted border-input flex h-4 items-center justify-center border-b border-l px-1.5 first:rounded-tr-md disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className="size-3" />
    </NumberFieldPrimitive.Increment>
  );
}

function NumberFieldDecrement({
  className,
  ...props
}: NumberFieldPrimitive.Decrement.Props) {
  return (
    <NumberFieldPrimitive.Decrement
      data-slot="number-field-decrement"
      className={cn(
        "hover:bg-muted border-input flex h-4 items-center justify-center border-l px-1.5 last:rounded-br-md disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="size-3" />
    </NumberFieldPrimitive.Decrement>
  );
}

function NumberField({
  className,
  placeholder,
  "aria-label": ariaLabel,
  ...props
}: NumberFieldPrimitive.Root.Props & { placeholder?: string }) {
  return (
    <NumberFieldRoot {...props}>
      <NumberFieldGroup className={className}>
        <NumberFieldInput placeholder={placeholder} aria-label={ariaLabel} />
        <div className="flex flex-col">
          <NumberFieldIncrement />
          <NumberFieldDecrement />
        </div>
      </NumberFieldGroup>
    </NumberFieldRoot>
  );
}

export {
  NumberField,
  NumberFieldRoot,
  NumberFieldGroup,
  NumberFieldInput,
  NumberFieldIncrement,
  NumberFieldDecrement,
};
