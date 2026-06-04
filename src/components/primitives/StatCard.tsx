import type { ReactNode } from "react";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export function StatCard({
  label,
  value,
  tooltip,
  icon: Icon,
  variant = "default",
  className,
  settingsLink,
}: {
  label: string;
  value: string | number | null;
  tooltip?: ReactNode;
  icon?: LucideIcon;
  variant?: "default" | "hero";
  className?: string;
  settingsLink?: string;
}) {
  const isHero = variant === "hero";

  const card = (
    <div className={cn("w-fit", className)}>
      <div className="flex items-center gap-1.5">
        {Icon && (
          <Icon
            className={cn(
              "text-muted-foreground shrink-0",
              isHero ? "size-3.5" : "size-3",
            )}
          />
        )}
        <div className="text-muted-foreground text-xs tracking-wider uppercase">
          {label}
        </div>
      </div>
      <div
        className={cn(
          "text-foreground font-mono font-bold",
          isHero ? "mt-1 text-2xl" : "text-lg",
        )}
      >
        {value ?? (
          <span>
            --
            {settingsLink && (
              <Link
                href={settingsLink}
                className="text-primary block text-[10px] font-medium hover:underline"
              >
                Configure
              </Link>
            )}
          </span>
        )}
      </div>
    </div>
  );

  if (!tooltip) return card;

  return (
    <Tooltip>
      <TooltipTrigger render={card} />
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
