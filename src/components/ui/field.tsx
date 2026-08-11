import { Field as FieldPrimitive } from "@base-ui/react/field";

import { cn } from "~/lib/utils";

function Field(props: FieldPrimitive.Root.Props) {
  return (
    <FieldPrimitive.Root
      data-slot="field"
      {...props}
      className={cn("flex flex-col gap-1.5", props.className)}
    />
  );
}

function FieldLabel(props: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      {...props}
      className={cn("text-sm font-medium", props.className)}
    />
  );
}

function FieldControl(props: FieldPrimitive.Control.Props) {
  return (
    <FieldPrimitive.Control
      data-slot="field-control"
      {...props}
      className={cn(
        "border-input bg-background ring-offset-background focus-visible:border-ring focus-visible:ring-ring/50 data-invalid:border-destructive data-invalid:ring-destructive/20 flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-3",
        props.className,
      )}
    />
  );
}

function FieldDescription(props: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      {...props}
      className={cn(
        "text-muted-foreground text-xs leading-snug",
        props.className,
      )}
    />
  );
}

function FieldError(props: FieldPrimitive.Error.Props) {
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      {...props}
      className={cn("text-destructive text-xs", props.className)}
    />
  );
}

export { Field, FieldControl, FieldDescription, FieldError, FieldLabel };
