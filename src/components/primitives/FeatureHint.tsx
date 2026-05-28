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
import { useDismissedHints } from "~/hooks/useDismissedHints";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";

interface FeatureHintProps {
  hintId: string;
  title: string;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export function FeatureHint({
  hintId,
  title,
  children,
  side = "bottom",
  className,
}: FeatureHintProps) {
  const t = useT();
  const { isDismissed, dismiss } = useDismissedHints();
  const [open, setOpen] = React.useState(false);

  if (isDismissed(hintId)) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        <button
          onClick={() => {
            dismiss(hintId);
            setOpen(false);
          }}
          className="text-primary hover:text-primary/80 self-end text-xs font-medium"
        >
          {t("auth.gotIt")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
