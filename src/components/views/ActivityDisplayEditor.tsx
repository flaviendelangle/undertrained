import { Select } from "~/components/primitives/Select";
import type { AppMessageKey } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import {
  ACTIVITY_COLUMNS,
  type ActivityDisplay,
} from "~/utils/activityFilters";

const columnLabels: Record<(typeof ACTIVITY_COLUMNS)[number], AppMessageKey> = {
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
      <div className="flex flex-col gap-2 text-sm">
        <Select
          label={t("views.groupBy")}
          className="w-full"
          value={draft.groupBy}
          onValueChange={(groupBy) => onChange({ ...draft, groupBy })}
          options={[
            { value: "none", label: t("views.groupNone") },
            { value: "sport", label: t("views.groupSport") },
            { value: "month", label: t("views.groupMonth") },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <Select
          label={t("common.sortBy")}
          className="w-full"
          value={draft.sort.id}
          onValueChange={(id) =>
            onChange({ ...draft, sort: { ...draft.sort, id } })
          }
          options={ACTIVITY_COLUMNS.map((id) => ({
            value: id,
            label: t(columnLabels[id]),
          }))}
        />
      </div>
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
