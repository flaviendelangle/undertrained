import type { AppMessageKey } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import {
  ACTIVITY_COLUMNS,
  type ActivityDisplay,
} from "~/utils/activityFilters";

import { viewInputClass } from "./ActivityFilterEditor";

export const columnLabels: Record<
  (typeof ACTIVITY_COLUMNS)[number],
  AppMessageKey
> = {
  type: "activities.columns.sport",
  name: "activities.columns.title",
  startDateLocal: "activities.columns.date",
  distance: "activities.columns.distance",
  totalElevationGain: "activities.columns.elevation",
  movingTime: "activities.columns.movingTime",
  averageSpeed: "activities.columns.pace",
  load: "activities.columns.load",
};

export function ActivityDisplayEditor({
  value: draft,
  onChange,
}: {
  value: ActivityDisplay;
  onChange: (display: ActivityDisplay) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="mb-3 text-sm font-medium">
          {t("views.columns")}
        </legend>
        {ACTIVITY_COLUMNS.map((id) => (
          <label key={id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.columns.includes(id)}
              onChange={(event) =>
                onChange({
                  ...draft,
                  columns: event.target.checked
                    ? ACTIVITY_COLUMNS.filter(
                        (c) => c === id || draft.columns.includes(c),
                      )
                    : draft.columns.filter((c) => c !== id),
                })
              }
            />
            {t(columnLabels[id])}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-2 text-sm">
        {t("views.groupBy")}
        <select
          className={viewInputClass}
          value={draft.groupBy}
          onChange={(event) =>
            onChange({
              ...draft,
              groupBy: event.target.value as ActivityDisplay["groupBy"],
            })
          }
        >
          {(["none", "sport", "month"] as const).map((groupBy) => (
            <option key={groupBy} value={groupBy}>
              {t(
                groupBy === "none"
                  ? "views.groupNone"
                  : groupBy === "sport"
                    ? "views.groupSport"
                    : "views.groupMonth",
              )}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2 text-sm">
        {t("views.sortBy")}
        <select
          className={viewInputClass}
          value={draft.sort.id}
          onChange={(event) =>
            onChange({
              ...draft,
              sort: {
                ...draft.sort,
                id: event.target.value as ActivityDisplay["sort"]["id"],
              },
            })
          }
        >
          {ACTIVITY_COLUMNS.map((id) => (
            <option key={id} value={id}>
              {t(columnLabels[id])}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.sort.desc}
          onChange={(event) =>
            onChange({
              ...draft,
              sort: { ...draft.sort, desc: event.target.checked },
            })
          }
        />
        {t("views.descending")}
      </label>
    </div>
  );
}
