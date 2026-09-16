import * as React from "react";

import { ListIcon } from "lucide-react";

import { ActivitiesTable } from "~/components/ActivitiesTable";
import { SyncPanel } from "~/components/SyncPanel";
import { SearchInput } from "~/components/primitives/SearchInput";
import { ActivityFilterPopover } from "~/components/settings/ActivityFilterPopover";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { useT } from "~/i18n/useT";
import { NextPageWithLayout } from "~/pages/_app";

const ActivitiesPage: NextPageWithLayout = () => {
  const t = useT();
  const [searchFilter, setSearchFilter] = React.useState("");

  return (
    <>
      <Toolbar
        label={t("activities.pageTitle")}
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
        <span className="font-semibold">{t("activities.pageTitle")}</span>
      </Toolbar>
      <div className="border-border border-b px-4 py-2">
        <SearchInput
          value={searchFilter}
          onChange={setSearchFilter}
          placeholder={t("settings.filter.searchPlaceholder")}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ActivitiesTable
          searchFilter={searchFilter}
          onClearSearch={() => setSearchFilter("")}
        />
      </div>
    </>
  );
};

export default ActivitiesPage;
