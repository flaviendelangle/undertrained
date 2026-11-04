import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A formatted value with its units set smaller and muted, so the digits carry
 * the weight: "2h 31m 40s", "72.4 km", "5:08 /km". `unit` appends one more.
 */
export function Quantity({ text, unit }: { text: string; unit?: string }) {
  // Split keeps the numbers (odd indexes) between the unit runs around them.
  // Digits right after a "/" belong to the unit ("1:45 /100m").
  const parts = text.split(/((?<![/\d])\d(?:[\d.,:  ]*\d)?)/);
  if (unit != null) parts[parts.length - 1] += ` ${unit}`;
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 1)
          return <React.Fragment key={index}>{part}</React.Fragment>;
        const trimmed = part.trim();
        if (trimmed === "") return null;
        return (
          <span
            key={index}
            className={cn(
              "text-muted-foreground text-[0.6em] font-medium tracking-normal",
              /^\s/.test(part) ? "ml-1" : "ml-0.5",
              /\s$/.test(part) && index < parts.length - 1 && "mr-1.5",
            )}
          >
            {trimmed}
          </span>
        );
      })}
    </>
  );
}
