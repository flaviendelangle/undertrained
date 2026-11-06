import * as React from "react";

import { format } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";

import type { ListActivity } from "@server/db/types";
import {
  type Row,
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  flexRender,
  globalFilteringFeature,
  metaHelper,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import { QueryState } from "~/components/primitives/QueryState";
import { RpeBar } from "~/components/primitives/RpeBar";
import { SportIconTile } from "~/components/primitives/SportIconTile";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useActivityView } from "~/hooks/useActivityView";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useSyncPanel } from "~/hooks/useSyncPanel";
import { type TFunction } from "~/i18n/I18nProvider";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import {
  ACTIVITY_COLUMNS,
  type ActivityDisplay,
  DEFAULT_ACTIVITY_DISPLAY,
  conditionCount,
} from "~/utils/activityFilters";
import {
  activityHref as activityReturnHref,
  readTimelineReturnTo,
} from "~/utils/activityLinks";
import { formatDuration, formatMeters } from "~/utils/format";
import { getActivityLoad, getLoadPreferences } from "~/utils/getActivityLoad";
import { getSportConfig } from "~/utils/sportConfig";

type ActivityWithoutMap = Omit<ListActivity, "mapPolyline"> & {
  load: number | null;
};

const features = tableFeatures({
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  // String sort names, including the default "auto", only resolve registered
  // functions. "auto" picks `text` or `alphanumeric` for the string columns.
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    text: sortFn_text,
  },
  // `numeric` right-aligns the column with tabular figures so values line up.
  columnMeta: metaHelper<{ minWidth?: number; numeric?: boolean }>(),
});

function ActivityRow(props: {
  row: Row<typeof features, ActivityWithoutMap>;
  style?: React.CSSProperties;
  getActivityHref: (id: number) => string;
}) {
  const { row, style } = props;
  const activityHref = props.getActivityHref(row.original.stravaId);

  return (
    <TableRow className="border-border/60 relative flex w-full" style={style}>
      {row.getVisibleCells().map((cell, cellIndex) => {
        const meta = cell.column.columnDef.meta;
        return (
          <TableCell
            className={cn(
              "flex min-w-0 items-center px-3 md:px-6",
              meta?.numeric && "justify-end tabular-nums",
            )}
            style={{ flex: cell.column.getSize(), minWidth: meta?.minWidth }}
            key={cell.id}
          >
            {cellIndex === 0 ? (
              <Link
                href={activityHref}
                className="truncate after:absolute after:inset-0"
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </Link>
            ) : (
              flexRender(cell.column.columnDef.cell, cell.getContext())
            )}
          </TableCell>
        );
      })}
    </TableRow>
  );
}

const columnHelper = createColumnHelper<typeof features, ActivityWithoutMap>();

const createColumns = (t: TFunction) =>
  columnHelper.columns([
    columnHelper.accessor("type", {
      cell: (info) => {
        const type = info.getValue();
        return (
          <span className="inline-flex items-center gap-2.5">
            <SportIconTile
              type={type}
              className="size-7 rounded-md"
              iconClassName="size-4"
            />
            <span className="truncate">{sportTypeLabel(type, t)}</span>
          </span>
        );
      },
      header: () => <span>{t("activities.columns.sport")}</span>,
      // Sizes are flex weights, not pixels. They must stay above TanStack's
      // default `minSize` (20), which would otherwise clamp them all to equal.
      size: 170,
      meta: { minWidth: 185 },
      filterFn: (row, _columnId, filterValue: string[]) => {
        if (filterValue.length === 0) return true;
        return filterValue.includes(row.getValue("type"));
      },
    }),
    columnHelper.accessor("name", {
      cell: (info) => (
        <span className="text-foreground truncate font-medium">
          {info.getValue()}
        </span>
      ),
      header: () => <span>{t("activities.columns.title")}</span>,
      size: 320,
      meta: { minWidth: 140 },
    }),
    columnHelper.accessor("startDateLocal", {
      cell: (info) => (
        <span className="truncate">
          {format(new Date(info.getValue().slice(0, 19)), "P p", {
            locale: getActiveDateLocale(),
          })}
        </span>
      ),
      header: () => <span>{t("activities.columns.date")}</span>,
      // Newest first, like the default sort. Starting ascending would make
      // clearing the default date sort fall back to itself, a dead click.
      sortDescFirst: true,
      size: 150,
      meta: { minWidth: 140 },
    }),
    columnHelper.accessor("distance", {
      cell: (info) => {
        const activity = info.row.original;
        return activity.distance === 0
          ? ""
          : getSportConfig(activity.type).formatDistance(activity.distance);
      },
      header: () => <span>{t("activities.columns.distance")}</span>,
      sortFn: "basic",
      size: 100,
      meta: { numeric: true },
    }),
    columnHelper.accessor("totalElevationGain", {
      cell: (info) => {
        const value = info.getValue();
        return value === 0 ? "" : formatMeters(value);
      },
      header: () => <span>{t("activities.columns.elevation")}</span>,
      sortFn: "basic",
      size: 90,
      meta: { numeric: true },
    }),
    columnHelper.accessor("movingTime", {
      cell: (info) => formatDuration(info.getValue()),
      header: () => <span>{t("activities.columns.movingTime")}</span>,
      sortFn: "basic",
      size: 100,
      meta: { numeric: true },
    }),
    columnHelper.accessor("averageSpeed", {
      cell: (info) => {
        const activity = info.row.original;
        return activity.averageSpeed === 0
          ? ""
          : getSportConfig(activity.type).formatSpeed(activity.averageSpeed);
      },
      header: () => <span>{t("activities.columns.pace")}</span>,
      sortFn: "basic",
      size: 100,
      meta: { numeric: true },
    }),
    columnHelper.accessor("load", {
      cell: (info) => {
        const value = info.getValue();
        return value != null ? Math.round(value) : "";
      },
      header: () => <span>{t("activities.columns.load")}</span>,
      sortFn: "basic",
      size: 70,
      meta: { numeric: true },
    }),
    columnHelper.accessor((activity) => activity.averageCadence ?? undefined, {
      id: "averageCadence",
      cell: (info) => {
        const value = info.getValue();
        return value != null
          ? `${Math.round(value)} ${getSportConfig(info.row.original.type).cadenceUnit}`
          : "";
      },
      header: () => <span>{t("activities.columns.cadence")}</span>,
      sortFn: "basic",
      sortDescFirst: true,
      sortUndefined: "last",
      size: 100,
      meta: { numeric: true, minWidth: 100 },
    }),
    columnHelper.accessor((activity) => activity.calories ?? undefined, {
      id: "calories",
      cell: (info) => {
        const value = info.getValue();
        return value != null ? `${Math.round(value)} kcal` : "";
      },
      header: () => <span>{t("activities.columns.calories")}</span>,
      sortFn: "basic",
      sortDescFirst: true,
      sortUndefined: "last",
      size: 100,
      meta: { numeric: true, minWidth: 100 },
    }),
    columnHelper.accessor(
      (activity) => activity.perceivedExertion ?? undefined,
      {
        id: "perceivedExertion",
        cell: (info) => {
          const value = info.getValue();
          return value != null ? <RpeBar rpe={value} /> : "";
        },
        header: () => <span>{t("activities.columns.rpe")}</span>,
        sortFn: "basic",
        sortDescFirst: true,
        sortUndefined: "last",
        size: 100,
        meta: { numeric: true, minWidth: 120 },
      },
    ),
  ]);

const ROW_HEIGHT = 48;
const MOBILE_ROW_HEIGHT = 80;
const VIRTUALIZER_OVERSCAN = 20;
const SKELETON_ROW_COUNT = 25;

export function ActivitiesTable() {
  const t = useT();
  const openSync = useSyncPanel();
  const isMobile = useIsMobile();
  const scope = useActivityView();
  const router = useRouter();
  const returnTo = readTimelineReturnTo(router.query);
  const getActivityHref = (id: number) =>
    returnTo
      ? activityReturnHref(id, router.asPath)
      : scope.href(`/activities/${id}`);
  const activitiesQuery = useActivitiesQuery("activities");
  const { timeline } = useRiderSettingsTimeline();
  const tableContainerRef = React.useRef<HTMLDivElement>(null);

  const columns = React.useMemo(() => createColumns(t), [t]);
  const loadPreferences = React.useMemo(
    () => getLoadPreferences(timeline),
    [timeline],
  );

  const data = React.useMemo(
    () =>
      (activitiesQuery.data ?? []).map((activity) => ({
        ...activity,
        load: getActivityLoad(activity, loadPreferences).value,
      })),
    [activitiesQuery.data, loadPreferences],
  );

  // Stable references: the table memoizes its sorted rows on these.
  const sorting = React.useMemo(
    () => [scope.display.sort],
    [scope.display.sort],
  );
  const columnVisibility = React.useMemo(
    () =>
      Object.fromEntries(
        ACTIVITY_COLUMNS.map((id) => [id, scope.display.columns.includes(id)]),
      ),
    [scope.display.columns],
  );
  const table = useTable({
    features,
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      // A view always has a sort, so clearing one falls back to the default.
      const sort = next[0] ?? DEFAULT_ACTIVITY_DISPLAY.sort;
      void scope.setDisplay({
        ...scope.display,
        sort: sort as ActivityDisplay["sort"],
      });
    },
  });
  const sortedRows = table.getRowModel().rows;
  type DisplayRow =
    | { kind: "activity"; row: (typeof sortedRows)[number] }
    | { kind: "group"; key: string; label: string; count: number };
  const rows = React.useMemo<DisplayRow[]>(() => {
    if (scope.display.groupBy === "none")
      return sortedRows.map((row) => ({ kind: "activity", row }));
    const groups = new Map<string, typeof sortedRows>();
    for (const row of sortedRows) {
      const key =
        scope.display.groupBy === "sport"
          ? row.original.type
          : row.original.startDateLocal.slice(0, 7);
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    return [...groups]
      .sort(([a], [b]) =>
        scope.display.groupBy === "month"
          ? b.localeCompare(a)
          : sportTypeLabel(a, t).localeCompare(sportTypeLabel(b, t)),
      )
      .flatMap(([key, group]) => [
        {
          kind: "group" as const,
          key,
          label:
            scope.display.groupBy === "sport"
              ? sportTypeLabel(key, t)
              : format(new Date(`${key}-01T12:00:00`), "MMMM yyyy", {
                  locale: getActiveDateLocale(),
                }),
          count: group.length,
        },
        ...group.map((row) => ({ kind: "activity" as const, row })),
      ]);
  }, [sortedRows, scope.display.groupBy, t]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) =>
      rows[index]?.kind === "group"
        ? 40
        : isMobile
          ? MOBILE_ROW_HEIGHT
          : ROW_HEIGHT,
    getScrollElement: () => tableContainerRef.current,
    overscan: VIRTUALIZER_OVERSCAN,
    getItemKey: (index) =>
      rows[index].kind === "group"
        ? `group-${rows[index].key}`
        : rows[index].row.id,
  });

  React.useEffect(() => {
    rowVirtualizer.measure();
  }, [isMobile, scope.display.groupBy, rowVirtualizer]);

  if (activitiesQuery.isError)
    return <QueryState error onRetry={() => void activitiesQuery.refetch()} />;
  if (!activitiesQuery.isLoading && rows.length === 0) {
    const filtered = conditionCount(scope.rules) > 0;
    return (
      <QueryState>
        <p>{t(filtered ? "common.noResults" : "common.noActivities")}</p>
        {filtered ? (
          <Button
            variant="outline"
            onClick={() => {
              void scope.selectView();
            }}
          >
            {t("settings.filter.clearAll")}
          </Button>
        ) : (
          <Button variant="outline" onClick={openSync}>
            {t("sync.label")}
          </Button>
        )}
      </QueryState>
    );
  }
  if (isMobile)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={tableContainerRef} className="min-h-0 flex-1 overflow-y-auto">
          {activitiesQuery.isLoading ? (
            <QueryState loading />
          ) : (
            <div
              role="list"
              style={{
                height: rowVirtualizer.getTotalSize(),
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((item) => {
                const entry = rows[item.index];
                if (entry.kind === "group")
                  return (
                    <div
                      key={entry.key}
                      className="bg-muted absolute left-0 flex w-full items-center gap-2 px-4 text-sm font-medium"
                      style={{
                        height: item.size,
                        transform: `translateY(${item.start}px)`,
                      }}
                    >
                      {scope.display.groupBy === "sport" && (
                        <SportIconTile
                          type={entry.key}
                          className="size-6 rounded-md"
                          iconClassName="size-3.5"
                        />
                      )}
                      <span>
                        {entry.label}{" "}
                        <span className="text-muted-foreground">
                          ({entry.count})
                        </span>
                      </span>
                    </div>
                  );
                const activity = entry.row.original;
                const sport = getSportConfig(activity.type);
                const href = getActivityHref(activity.stravaId);
                const shown = scope.display.columns;
                // Zero values are dropped, as in the desktop cells: a strength
                // session has no distance, elevation, or speed worth showing.
                const details = [
                  shown.includes("type") && sportTypeLabel(activity.type, t),
                  shown.includes("startDateLocal") &&
                    format(
                      new Date(activity.startDateLocal.slice(0, 19)),
                      "P p",
                      { locale: getActiveDateLocale() },
                    ),
                ].filter((part) => typeof part === "string");
                const stats = [
                  shown.includes("distance") &&
                    activity.distance > 0 &&
                    sport.formatDistance(activity.distance),
                  shown.includes("movingTime") &&
                    formatDuration(activity.movingTime),
                  shown.includes("totalElevationGain") &&
                    activity.totalElevationGain > 0 &&
                    formatMeters(activity.totalElevationGain),
                  shown.includes("averageSpeed") &&
                    activity.averageSpeed > 0 &&
                    sport.formatSpeed(activity.averageSpeed),
                  shown.includes("load") &&
                    activity.load != null &&
                    `${t("activities.columns.load")}: ${Math.round(activity.load)}`,
                  shown.includes("averageCadence") &&
                    activity.averageCadence != null &&
                    `${Math.round(activity.averageCadence)} ${sport.cadenceUnit}`,
                  shown.includes("calories") &&
                    activity.calories != null &&
                    `${Math.round(activity.calories)} kcal`,
                  shown.includes("perceivedExertion") &&
                    activity.perceivedExertion != null &&
                    `${t("activities.columns.rpe")}: ${activity.perceivedExertion}/10`,
                ].filter((part) => typeof part === "string");
                return (
                  <div
                    role="listitem"
                    key={activity.stravaId}
                    className="absolute left-0 w-full"
                    style={{
                      height: item.size,
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <Link
                      href={href}
                      className="border-border/60 hover:bg-accent focus-visible:bg-accent flex h-full min-w-0 items-center gap-3 border-b px-4"
                    >
                      {shown.includes("type") && (
                        <SportIconTile
                          type={activity.type}
                          className="size-10 rounded-xl"
                          iconClassName="size-5"
                        />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">
                          {activity.name}
                        </span>
                        {details.length > 0 && (
                          <span className="text-muted-foreground truncate text-xs">
                            {details.join(" · ")}
                          </span>
                        )}
                        {stats.length > 0 && (
                          <span className="text-foreground/80 truncate text-xs tabular-nums">
                            {stats.join(" · ")}
                          </span>
                        )}
                      </span>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Table
        containerRef={tableContainerRef}
        containerClassName="min-h-0 flex-1"
        className="text-muted-foreground grid min-w-[700px] text-left text-sm"
      >
        <TableHeader className="bg-accent text-muted-foreground sticky top-0 z-10 grid text-xs uppercase">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="flex w-full">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  aria-sort={
                    header.column.getIsSorted() === "asc"
                      ? "ascending"
                      : header.column.getIsSorted() === "desc"
                        ? "descending"
                        : "none"
                  }
                  title={
                    header.column.getCanSort()
                      ? header.column.getNextSortingOrder() === "asc"
                        ? t("activities.sortAscending")
                        : header.column.getNextSortingOrder() === "desc"
                          ? t("activities.sortDescending")
                          : t("activities.clearSort")
                      : undefined
                  }
                  className={cn(
                    "flex min-w-0 items-center px-3 py-3 md:px-6",
                    header.column.columnDef.meta?.numeric && "justify-end",
                  )}
                  style={{
                    flex: header.column.getSize(),
                    minWidth: header.column.columnDef.meta?.minWidth,
                  }}
                >
                  {header.isPlaceholder ? null : (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="focus-visible:ring-ring inline-flex items-center rounded focus-visible:ring-2 data-[sortable=true]:cursor-pointer"
                      data-sortable={header.column.getCanSort()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {{
                        asc: <span>&nbsp;&#9650;</span>,
                        desc: <span>&nbsp;&#9660;</span>,
                      }[header.column.getIsSorted() as string] ?? null}
                    </button>
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody
          className="relative grid"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {activitiesQuery.isLoading
            ? Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
                <TableRow key={index} className="border-border/60 flex h-12">
                  {table.getVisibleFlatColumns().map((col) => (
                    <TableCell
                      key={col.id}
                      className={cn(
                        "flex min-w-0 items-center px-3 md:px-6",
                        col.columnDef.meta?.numeric && "justify-end",
                      )}
                      style={{
                        flex: col.getSize(),
                        minWidth: col.columnDef.meta?.minWidth,
                      }}
                    >
                      <div
                        className={cn(
                          "bg-border h-4 animate-pulse rounded",
                          col.columnDef.meta?.numeric ? "w-12" : "w-32",
                        )}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const entry = rows[virtualRow.index];
                if (entry.kind === "group")
                  return (
                    <TableRow
                      key={entry.key}
                      className="bg-muted text-foreground absolute left-0 flex w-full items-center px-4 text-sm font-medium"
                      style={{
                        height: virtualRow.size,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <TableCell className="flex items-center gap-2 py-0">
                        {scope.display.groupBy === "sport" && (
                          <SportIconTile
                            type={entry.key}
                            className="size-6 rounded-md"
                            iconClassName="size-3.5"
                          />
                        )}
                        <span>
                          {entry.label}{" "}
                          <span className="text-muted-foreground">
                            ({entry.count})
                          </span>
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                const row = entry.row;
                return (
                  <ActivityRow
                    key={row.id}
                    row={row}
                    getActivityHref={getActivityHref}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  />
                );
              })}
        </TableBody>
      </Table>
    </div>
  );
}
