import * as React from "react";

import { format } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";
import Link from "next/link";

import type { Activity } from "@server/db/types";
import {
  type Row,
  type RowData,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { formatActivityType, formatDuration } from "~/utils/format";
import { getActivityLoad, getLoadPreferences } from "~/utils/getActivityLoad";
import { getSportConfig } from "~/utils/sportConfig";

type ActivityWithoutMap = Omit<Activity, "mapPolyline"> & { load: number | null };

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    minWidth?: number;
  }
}

function ActivityRow(props: {
  row: Row<ActivityWithoutMap>;
  index: number;
  style?: React.CSSProperties;
  timePeriodId?: number;
}) {
  const { row, index, style, timePeriodId } = props;
  const activityHref = timePeriodId != null
    ? `/activities/${row.original.stravaId}?from=period&periodId=${timePeriodId}`
    : `/activities/${row.original.stravaId}`;

  return (
    <TableRow
      className="data-[odd=true]:bg-secondary data-[odd=true]:hover:bg-accent relative flex w-full border-0"
      data-odd={index % 2 === 1}
      style={style}
    >
      {row.getVisibleCells().map((cell, cellIndex) => {
        const minWidth = cell.column.columnDef.meta?.minWidth;
        return (
        <TableCell
          className="flex min-w-0 items-center px-3 md:px-6"
          style={{ flex: cell.column.getSize(), minWidth }}
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

const columnHelper = createColumnHelper<ActivityWithoutMap>();

const columns = [
  columnHelper.accessor("type", {
    cell: (info) => {
      const type = info.getValue();
      const Icon = getSportConfig(type).icon;
      return (
        <span className="inline-flex items-center gap-2">
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{formatActivityType(type)}</span>
        </span>
      );
    },
    header: () => <span>Sport</span>,
    size: 2,
    meta: { minWidth: 155 },
    filterFn: (row, _columnId, filterValue: string[]) => {
      if (filterValue.length === 0) return true;
      return filterValue.includes(row.getValue("type"));
    },
  }),
  columnHelper.accessor("name", {
    cell: (info) => <span className="truncate">{info.getValue()}</span>,
    header: () => <span>Title</span>,
    size: 3,
    meta: { minWidth: 140 },
  }),
  columnHelper.accessor("startDateLocal", {
    cell: (info) => <span className="truncate">{format(new Date(info.getValue()), "P p", { locale: enGB })}</span>,
    header: () => <span>Date</span>,
    size: 2,
    meta: { minWidth: 140 },
  }),
  columnHelper.accessor("distance", {
    cell: (info) => {
      const activity = info.row.original;
      return activity.distance === 0
        ? ""
        : getSportConfig(activity.type).formatDistance(activity.distance);
    },
    header: () => <span>Distance</span>,
    sortingFn: "basic",
    size: 1,
  }),
  columnHelper.accessor("totalElevationGain", {
    cell: (info) => {
      const value = info.getValue();
      return value === 0 ? "" : `${Math.round(value)} m`;
    },
    header: () => <span>Elevation</span>,
    sortingFn: "basic",
    size: 1,
  }),
  columnHelper.accessor("movingTime", {
    cell: (info) => formatDuration(info.getValue()),
    header: () => <span>Moving Time</span>,
    sortingFn: "basic",
    size: 1,
  }),
  columnHelper.accessor("averageSpeed", {
    cell: (info) => {
      const activity = info.row.original;
      return activity.averageSpeed === 0
        ? ""
        : getSportConfig(activity.type).formatSpeed(activity.averageSpeed);
    },
    header: () => <span>Pace</span>,
    sortingFn: "basic",
    size: 1,
  }),
  columnHelper.accessor("load", {
    cell: (info) => {
      const value = info.getValue();
      return value != null ? Math.round(value) : "";
    },
    header: () => <span>Load</span>,
    sortingFn: "basic",
    size: 1,
  }),
];

const ROW_HEIGHT = 48;
const VIRTUALIZER_OVERSCAN = 20;
const SKELETON_ROW_COUNT = 25;

const activitySearchFilter = (
  row: Row<ActivityWithoutMap>,
  _columnId: string,
  filterValue: string,
) => {
  if (!filterValue) return true;
  const activity = row.original;
  const haystack = [
    activity.name,
    formatActivityType(activity.type),
    format(new Date(activity.startDateLocal), "P p", { locale: enGB }),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(filterValue.toLowerCase());
};

export function ActivitiesTable(props: { searchFilter?: string; timePeriodId?: number }) {
  const activitiesQuery = useActivitiesQuery(
    props.timePeriodId != null ? { timePeriodId: props.timePeriodId } : undefined,
  );
  const { timeline } = useRiderSettingsTimeline();
  const tableContainerRef = React.useRef<HTMLDivElement>(null);

  const loadPreferences = React.useMemo(
    () => getLoadPreferences(timeline),
    [timeline],
  );

  const data = React.useMemo(
    () => (activitiesQuery.data ?? []).map((activity) => ({
      ...activity,
      load: getActivityLoad(activity, loadPreferences).value,
    })),
    [activitiesQuery.data, loadPreferences],
  );

  const table = useReactTable({
    data,
    columns,
    state: { globalFilter: props.searchFilter ?? "" },
    globalFilterFn: activitySearchFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: {
      sorting: [{ id: "startDateLocal", desc: true }],
    },
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => tableContainerRef.current,
    overscan: VIRTUALIZER_OVERSCAN,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Table
        containerRef={tableContainerRef}
        containerClassName="border-border min-h-0 flex-1 md:border"
        className="text-muted-foreground grid min-w-[700px] text-left text-sm"
      >
        <TableHeader className="bg-accent text-muted-foreground sticky top-0 z-10 grid text-xs uppercase">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="flex w-full">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  onClick={header.column.getToggleSortingHandler()}
                  title={
                    header.column.getCanSort()
                      ? header.column.getNextSortingOrder() === "asc"
                        ? "Sort ascending"
                        : header.column.getNextSortingOrder() === "desc"
                          ? "Sort descending"
                          : "Clear sort"
                      : undefined
                  }
                  className="flex min-w-0 items-center px-3 py-3 md:px-6"
                  style={{ flex: header.column.getSize(), minWidth: header.column.columnDef.meta?.minWidth }}
                >
                  {header.isPlaceholder ? null : (
                    <div
                      className="inline-flex items-center data-[sortable=true]:cursor-pointer"
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
                    </div>
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
                <TableRow key={index} className="odd:bg-secondary flex h-12">
                  {table.getVisibleFlatColumns().map((col) => (
                    <TableCell
                      key={col.id}
                      className="flex min-w-0 items-center px-3 md:px-6"
                      style={{ flex: col.getSize(), minWidth: col.columnDef.meta?.minWidth }}
                    >
                      <div className="bg-border h-4 w-32 animate-pulse" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <ActivityRow
                    key={row.id}
                    row={row}
                    index={virtualRow.index}
                    timePeriodId={props.timePeriodId}
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
