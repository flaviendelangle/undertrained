import * as React from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
} from "~/components/ui/select";
import { useActivityView } from "~/hooks/useActivityView";
import { useT } from "~/i18n/useT";

import { groupViewsByFolder } from "./groupViewsByFolder";

/** Switches the active saved view; `children` is the trigger. */
export function ViewPicker({
  children,
  onSelect,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
}) {
  const t = useT();
  const scope = useActivityView();
  return (
    <Select
      value={scope.view ? String(scope.view.id) : ""}
      onValueChange={(value) => {
        if (value !== null)
          void scope
            .selectView(value ? Number(value) : undefined)
            .then(onSelect);
      }}
    >
      {children}
      <SelectContent align="start" alignItemWithTrigger={false} className="p-1">
        <SelectItem value="">{t("views.allActivities")}</SelectItem>
        {groupViewsByFolder(
          scope.views,
          scope.folders,
          t("views.ungrouped"),
        ).map((group) => {
          const items = group.views.map((view) => (
            <SelectItem key={view.id} value={String(view.id)}>
              {view.name}
            </SelectItem>
          ));
          return group.label === null ? (
            <React.Fragment key={group.key}>{items}</React.Fragment>
          ) : (
            <SelectGroup key={group.key} className="p-0 pt-1.5">
              <SelectLabel>{group.label}</SelectLabel>
              {items}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}
