import * as React from "react";

import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "~/components/ui/combobox";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { PLANNABLE_SPORT_TYPES, getSportConfig } from "~/utils/sportConfig";

/** Sport label + coloured icon for a select option / value. */
export function SportOption({ sportType }: { sportType: string }) {
  const t = useT();
  const config = getSportConfig(sportType);
  const Icon = config.icon;
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-4 shrink-0" style={{ color: config.color }} />
      {sportTypeLabel(sportType, t)}
    </span>
  );
}

/** Group shape consumed by the sport Combobox. */
interface SportGroup {
  value: string;
  items: string[];
}

/**
 * Sport picker built on the searchable Combobox. The athlete's four most
 * recently practised sports are surfaced in a "Favorite sports" group ahead of
 * the rest, derived from their activity history. `extraSportTypes` adds entries
 * outside the plannable set (e.g. an activity's current, unusual sport) so they
 * stay selectable.
 */
export function SportPicker({
  value,
  onChange,
  extraSportTypes,
}: {
  value: string;
  onChange: (value: string) => void;
  extraSportTypes?: string[];
}) {
  const t = useT();
  // Empty options => unfiltered, all-time history, regardless of the global
  // activity filter the rest of the app applies.
  const { data: activities } = useActivitiesQuery({});

  const groups = React.useMemo<SportGroup[]>(() => {
    const allSports = [...PLANNABLE_SPORT_TYPES];
    for (const extra of extraSportTypes ?? []) {
      if (!allSports.includes(extra)) {
        allSports.push(extra);
      }
    }

    const latestByType = new Map<string, string>();
    for (const activity of activities ?? []) {
      if (!allSports.includes(activity.type)) {
        continue;
      }
      const previous = latestByType.get(activity.type);
      // startDateLocal is a fixed-format ISO string, so lexical compare = chrono.
      if (previous == null || activity.startDateLocal > previous) {
        latestByType.set(activity.type, activity.startDateLocal);
      }
    }
    const byLabel = (a: string, b: string) =>
      sportTypeLabel(a, t).localeCompare(sportTypeLabel(b, t));

    // Pick the four most recent by recency, then present them alphabetically.
    const favorites = [...latestByType.entries()]
      .sort(([, a], [, b]) => (a < b ? 1 : -1))
      .slice(0, 4)
      .map(([type]) => type)
      .sort(byLabel);

    const result: SportGroup[] = [];
    if (favorites.length > 0) {
      result.push({
        value: t("journal.dialog.favoriteSports"),
        items: favorites,
      });
    }
    const rest = allSports
      .filter((type) => !favorites.includes(type))
      .sort(byLabel);
    if (rest.length > 0) {
      result.push({
        value:
          favorites.length > 0
            ? t("journal.dialog.otherSports")
            : t("journal.dialog.sports"),
        items: rest,
      });
    }
    return result;
  }, [activities, t, extraSportTypes]);

  return (
    <Combobox
      items={groups}
      value={value}
      onValueChange={(next) => next && onChange(next)}
      itemToStringLabel={(type) => sportTypeLabel(type, t)}
    >
      <ComboboxTrigger className="w-full">
        <ComboboxValue>
          {(selected: string) => <SportOption sportType={selected} />}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput placeholder={t("journal.dialog.searchSports")} />
        <ComboboxEmpty>{t("journal.dialog.noSportFound")}</ComboboxEmpty>
        <ComboboxList>
          {(group: SportGroup) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxGroupLabel>{group.value}</ComboboxGroupLabel>
              <ComboboxCollection>
                {(sportType: string) => (
                  <ComboboxItem key={sportType} value={sportType}>
                    <SportOption sportType={sportType} />
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
