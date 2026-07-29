import * as React from "react";

import {
  Tooltip as ShadTooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

export function Tooltip(props: TooltipProps) {
  const { children, label, side = "right" } = props;
  return (
    <ShadTooltip>
      <TooltipTrigger render={<span />}>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </ShadTooltip>
  );
}

export interface TooltipProps {
  children: React.ReactNode;
  label: string;
  side?: "top" | "right" | "bottom" | "left";
}
