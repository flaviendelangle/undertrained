import * as React from "react";

import { ListIcon } from "lucide-react";

import { ActivitiesTable } from "~/components/ActivitiesTable";
import { SyncPanel } from "~/components/SyncPanel";
import { ActivityFilterPopover } from "~/components/settings/ActivityFilterPopover";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { NextPageWithLayout } from "~/pages/_app";

const ActivitiesPage: NextPageWithLayout = () => {
  const [searchFilter, setSearchFilter] = React.useState("");

  return (
    <>
      <Toolbar
        actions={
          <>
            <ActivityFilterPopover
              search={searchFilter}
              onSearchChange={setSearchFilter}
            />
            <SyncPanel />
          </>
        }
      >
        <ListIcon className="size-4" />
        <span className="font-semibold">Activities</span>
      </Toolbar>
      <div className="flex flex-1 flex-col overflow-hidden p-0 pt-3 md:p-4">
        <ActivitiesTable searchFilter={searchFilter} />
      </div>
    </>
  );
};

export default ActivitiesPage;
