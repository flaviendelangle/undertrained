import type { ReactNode } from "react";

import { XIcon } from "lucide-react";

import { useDismissedHints } from "~/hooks/useDismissedHints";
import { cn } from "~/lib/utils";

interface PageIntroProps {
  hintId: string;
  children: ReactNode;
  className?: string;
}

export function PageIntro({ hintId, children, className }: PageIntroProps) {
  const { isDismissed, dismiss } = useDismissedHints();

  if (isDismissed(hintId)) return null;

  return (
    <div
      className={cn(
        "bg-card border-border relative flex items-start gap-3 rounded-sm border border-l-4 border-l-primary/40 p-4",
        className,
      )}
    >
      <div className="text-muted-foreground min-w-0 flex-1 text-sm leading-relaxed">
        {children}
      </div>
      <button
        onClick={() => dismiss(hintId)}
        className="text-muted-foreground hover:text-foreground shrink-0 p-0.5"
        aria-label="Dismiss"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
