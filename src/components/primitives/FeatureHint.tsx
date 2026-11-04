import * as React from "react";

import { InfoIcon } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";

interface FeatureHintProps {
  title: string;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/**
 * An info icon that opens an explanation of what a chart shows, for what
 * the chart can't say on its own (what its colours mean, say). Always shown.
 */
export function FeatureHint({
  title,
  children,
  side = "bottom",
  className,
}: FeatureHintProps) {
  const t = useT();

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(
              "text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center justify-center rounded-full p-0.5 transition-colors",
              className,
            )}
            aria-label={t("auth.learnAbout", { title })}
          >
            <InfoIcon className="size-3.5" />
          </button>
        }
      />
      <PopoverContent side={side} className="w-72">
        <PopoverHeader>
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverDescription>{children}</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  );
}
