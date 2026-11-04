import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A formatted value with its units set smaller and muted, so the digits carry
 * the weight: "2h 31m 40s", "72.4 km", "5:08 /km". `unit` appends one more.
 * The units shrink to 0.6em, sized for headline values; `unitClassName`
 * overrides that size where the value itself is small.
 */
export function Quantity({
  text,
  unit,
  unitClassName = "text-[0.6em]",
}: {
  text: string;
  unit?: string;
  unitClassName?: string;
}) {
  // Split keeps the numbers (odd indexes) between the unit runs around them.
  // Digits right after a "/" belong to the unit ("1:45 /100m").
  const parts = text.split(/((?<![/\d])\d(?:[\d.,:\u00a0\u202f]*\d)?)/);
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
              "text-muted-foreground font-medium tracking-normal",
              unitClassName,
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
