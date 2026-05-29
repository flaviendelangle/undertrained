import type { ReactNode } from "react";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

export function Toolbar({
  children,
  actions,
  label,
}: {
  children?: ReactNode;
  actions?: ReactNode;
  label?: string;
}) {
  return (
    <ToolbarPrimitive.Root
      aria-label={label}
      className="border-border flex h-16 shrink-0 items-center gap-1.5 border-b px-4"
    >
      {children}
      <div className="min-w-0 flex-1" />
      {actions}
    </ToolbarPrimitive.Root>
  );
}
