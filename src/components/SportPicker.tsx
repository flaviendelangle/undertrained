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

/** Sports sorted by label, comma-separated with their coloured icons, ellipsed on one line. */
export function SportList({ sportTypes }: { sportTypes: readonly string[] }) {
  const t = useT();
  const sorted = [...sportTypes].sort((a, b) =>
    sportTypeLabel(a, t).localeCompare(sportTypeLabel(b, t)),
  );
  return (
    <span className="min-w-0 truncate">
      {sorted.map((sportType, index) => {
        const config = getSportConfig(sportType);
        const Icon = config.icon;
        return (
          <React.Fragment key={sportType}>
            {index > 0 && ", "}
            <Icon
              className="mr-1.5 inline size-4 align-[-3px]"
              style={{ color: config.color }}
            />
            {sportTypeLabel(sportType, t)}
          </React.Fragment>
        );
      })}
    </span>
  );
}

/** Group shape consumed by the sport Combobox. */
interface SportGroup {
  value: string;
  items: string[];
}

/**
 * Groups `sportTypes` for a sport Combobox. The athlete's four most recently
 * practised sports are surfaced in a "Favorite sports" group ahead of the rest,
 * derived from their activity history. Both groups are sorted by label.
 */
function useSportGroups(sportTypes: readonly string[]): SportGroup[] {
  const t = useT();
  // Unfiltered, all-time history, regardless of the global activity filter.
  const { data: activities } = useActivitiesQuery("sportPicker");

  return React.useMemo(() => {
    const candidates = new Set(sportTypes);
    const latestByType = new Map<string, string>();
    for (const activity of activities ?? []) {
      if (!candidates.has(activity.type)) {
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
    const rest = [...candidates]
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
  }, [activities, t, sportTypes]);
}

/** Searchable popup listing the sport groups, shared by both pickers. */
function SportComboboxContent({
  className,
  align,
}: {
  className?: string;
  align?: "start" | "center" | "end";
}) {
  const t = useT();
  return (
    <ComboboxContent className={className} align={align}>
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
  );
}

/**
 * Sport picker built on the searchable Combobox, offering the plannable sports.
 * `extraSportTypes` adds entries outside the plannable set (e.g. an activity's
 * current, unusual sport) so they stay selectable.
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
  const sportTypes = React.useMemo(
    () => [...new Set([...PLANNABLE_SPORT_TYPES, ...(extraSportTypes ?? [])])],
    [extraSportTypes],
  );
  const groups = useSportGroups(sportTypes);

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
      <SportComboboxContent />
    </Combobox>
  );
}

/**
 * Multiple-selection variant of `SportPicker`, grouped and searchable the same
 * way. It offers `sportTypes` plus the selected values, so a selected sport can
 * always be deselected. `children` is the trigger, to let callers wrap it.
 */
export function SportMultiPicker({
  value,
  onChange,
  sportTypes,
  children,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  sportTypes: readonly string[];
  children: React.ReactNode;
}) {
  const t = useT();
  const candidates = React.useMemo(
    () => [...new Set([...sportTypes, ...value])],
    [sportTypes, value],
  );
  const groups = useSportGroups(candidates);

  return (
    <Combobox
      multiple
      items={groups}
      value={value}
      onValueChange={onChange}
      itemToStringLabel={(type) => sportTypeLabel(type, t)}
    >
      {children}
      <SportComboboxContent
        align="start"
        className="w-[max(var(--anchor-width),15rem)]"
      />
    </Combobox>
  );
}
