import { FilterIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTrigger,
} from "~/components/ui/responsive-dialog";
import { useActivityFilter } from "~/hooks/useActivityFilter";

import { ActivityFilterPanel } from "./ActivityFilterPanel";

export function ActivityFilterPopover({
  search,
  onSearchChange,
}: {
  /** When provided, a text search field is shown inside the filter panel. */
  search?: string;
  onSearchChange?: (value: string) => void;
} = {}) {
  const { activeFilterCount } = useActivityFilter();

  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground gap-1.5"
          >
            <FilterIcon className="size-3.5" />
            <span>Filter</span>
            {activeFilterCount > 0 && (
              <span className="bg-primary/20 text-primary-foreground rounded px-1 text-xs">
                {activeFilterCount}
              </span>
            )}
          </Button>
        }
      />
      <ResponsiveDialogContent className="sm:max-w-sm">
        <ActivityFilterPanel search={search} onSearchChange={onSearchChange} />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
