import * as React from "react";

import { Label } from "~/components/ui/label";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";

import { Select, SelectProps } from "./primitives/Select";

export function ActivityTypeSelect(props: Omit<SelectProps, "options">) {
  const t = useT();
  const { allTypes: activityTypes } = useActivitiesQuery();

  const options = React.useMemo<ActivityTypeConfig[]>(() => {
    return (
      activityTypes?.map((activityType) => ({
        value: activityType,
        label: sportTypeLabel(activityType, t),
      })) ?? []
    );
  }, [activityTypes, t]);

  return (
    <div className="flex w-full items-center justify-between gap-1 align-baseline">
      <Label className="text-foreground">{t("activities.name")}</Label>
      <Select {...props} options={options} />
    </div>
  );
}

interface ActivityTypeConfig {
  value: string;
  label: string;
}
