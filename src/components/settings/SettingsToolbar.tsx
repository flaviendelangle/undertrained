import type { ReactNode } from "react";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

import { cn } from "~/lib/utils";

export function Toolbar({
  children,
  actions,
  label,
  contentClassName,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  label?: string;
  /**
   * Applied to the inner row. Pages that cap their body width pass
   * `mx-auto max-w-5xl` here so the toolbar's actions line up with the content
   * instead of hugging the far edge of a wide monitor.
   */
  contentClassName?: string;
}) {
  return (
    <ToolbarPrimitive.Root
      aria-label={label}
      className="border-border flex h-16 shrink-0 items-center border-b px-4"
    >
      <div className={cn("flex w-full items-center gap-1.5", contentClassName)}>
        {children}
        <div className="min-w-0 flex-1" />
        {actions}
      </div>
    </ToolbarPrimitive.Root>
  );
}
