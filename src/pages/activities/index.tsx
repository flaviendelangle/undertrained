import * as React from "react";

import { SearchIcon, XIcon } from "lucide-react";

import { ActivitiesTable } from "~/components/ActivitiesTable";
import { SyncPanel } from "~/components/SyncPanel";
import { ActivityFilterPopover } from "~/components/settings/ActivityFilterPopover";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { NextPageWithLayout } from "~/pages/_app";

const ActivitiesPage: NextPageWithLayout = () => {
  const [searchFilter, setSearchFilter] = React.useState("");

  return (
    <>
      <Toolbar>
        <ActivityFilterPopover />
        <div className="bg-border mx-1 h-4 w-px" />
        <div className="border-border focus-within:ring-ring relative flex items-center rounded-md border focus-within:ring-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute left-2.5 size-3.5" />
          <input
            type="text"
            placeholder="Search activities..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="placeholder:text-muted-foreground h-8 w-44 rounded-md bg-transparent py-1 pl-8 pr-2 text-sm outline-none"
          />
          {searchFilter && (
            <button
              onClick={() => setSearchFilter("")}
              className="text-muted-foreground hover:text-foreground absolute right-1.5 flex size-4 items-center justify-center"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
        <div className="bg-border mx-1 h-4 w-px" />
        <SyncPanel />
      </Toolbar>
      <div className="flex flex-1 flex-col overflow-hidden p-0 pt-3 md:p-4">
        <ActivitiesTable searchFilter={searchFilter} />
      </div>
    </>
  );
};

export default ActivitiesPage;
