import * as React from "react";

import { FilterIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { formatActivityType } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";

interface SportTypeFilterProps {
  allTypes: string[] | undefined;
  selectedTypes: string[];
  setSelectedTypes: React.Dispatch<React.SetStateAction<string[]>>;
}

/** Grid of toggleable sport-type chips with a "Clear" affordance. */
export function SportTypeFilter({
  allTypes,
  selectedTypes,
  setSelectedTypes,
}: SportTypeFilterProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">Sport Types</span>
        {selectedTypes.length > 0 && (
          <button
            onClick={() => setSelectedTypes([])}
            className="text-muted-foreground hover:text-foreground text-[10px]"
          >
            Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {allTypes?.map((type) => {
          const Icon = getSportConfig(type).icon;
          const active = selectedTypes.includes(type);
          return (
            <button
              key={type}
              onClick={() =>
                setSelectedTypes((prev) =>
                  active ? prev.filter((t) => t !== type) : [...prev, type],
                )
              }
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{formatActivityType(type)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Desktop-only sport filter: a popover trigger wrapping {@link SportTypeFilter}. */
export function SportFilterPopover(props: SportTypeFilterProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hidden gap-1.5 sm:inline-flex"
          >
            <FilterIcon className="size-3.5" />
            <span>Sport</span>
            {props.selectedTypes.length > 0 && (
              <span className="bg-primary/20 text-primary-foreground rounded px-1 text-xs">
                {props.selectedTypes.length}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-56 p-3">
        <SportTypeFilter {...props} />
      </PopoverContent>
    </Popover>
  );
}
