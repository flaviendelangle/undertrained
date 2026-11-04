import * as React from "react";

import {
  BarChart3Icon,
  ListIcon,
  MapIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import Link from "next/link";

import { Draggable } from "@base-ui/react/draggable";
import type { SavedViewStats } from "@server/trpc/routers/views";

import { SportIconTile } from "~/components/primitives/SportIconTile";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import type { SavedActivityView } from "~/hooks/useActivityView";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { ACTIVITY_PRESENTATION_PATHS } from "~/utils/activityViewState";
import { formatMeters, formatNumber } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";

import type { ViewFolder } from "./ViewFolderNav";
import { savedViewKind } from "./ViewFolderNav";
import type { ViewGroup } from "./groupViewsByFolder";
import {
  formatTotalDistance,
  formatTotalTime,
  viewPeriod,
} from "./savedViewStats";

const PRESENTATIONS = [
  { id: "list", label: "views.list", icon: ListIcon },
  { id: "map", label: "views.map", icon: MapIcon },
  { id: "charts", label: "views.charts", icon: BarChart3Icon },
] as const;
/** Sport tiles shown before the rest collapse into "+N". */
const MAX_SPORTS = 3;

/**
 * One template for the header and every row, so the columns line up. The
 * main pane is a size container: as it narrows, elevation, time and distance
 * go first, then the period, then the sports, so the name keeps its room.
 */
const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_5rem_8.5rem] items-center gap-x-3 px-4 @min-[36rem]:grid-cols-[6rem_minmax(0,1fr)_5rem_8.5rem] @min-[46rem]:grid-cols-[6rem_minmax(0,3fr)_minmax(0,2fr)_5rem_8.5rem] @min-[60rem]:grid-cols-[6rem_minmax(0,3fr)_minmax(0,2fr)_5rem_5.5rem_5.5rem_6rem_8.5rem]";
const SPORTS_UP = "hidden @min-[36rem]:flex";
const PERIOD_UP = "hidden @min-[46rem]:flex";
const TOTALS_UP = "hidden @min-[60rem]:flex";

export interface SavedViewActions {
  href: (view: SavedActivityView, path?: string) => string;
  onRename: (view: SavedActivityView) => void;
  onDuplicate: (view: SavedActivityView) => void;
  onDelete: (view: SavedActivityView) => void;
  onMove: (view: SavedActivityView, folderId: number | null) => void;
}

/** The view's numbers, formatted; `null` while its stats load. */
function useViewSummary(
  stats: SavedViewStats | undefined,
  today: string,
): {
  sports: string[];
  period: string;
  activities: number;
  count: string;
  distance: string;
  elevation: string;
  time: string;
} | null {
  const t = useT();
  if (!stats) return null;
  const period =
    stats.firstDay && stats.lastDay
      ? viewPeriod(stats.firstDay, stats.lastDay, today)
      : null;
  return {
    sports: stats.sports,
    period: !period
      ? t("views.noActivities")
      : period.since
        ? t("views.since", { date: period.label })
        : period.label,
    activities: stats.count,
    count: formatNumber(stats.count, 0),
    // Like the activity table, a sum of zero is an empty cell, not "0 km".
    distance: stats.distance > 0 ? formatTotalDistance(stats.distance) : "",
    elevation: stats.elevation > 0 ? formatMeters(stats.elevation) : "",
    time: stats.movingTime > 0 ? formatTotalTime(stats.movingTime) : "",
  };
}

/**
 * The view's sports as tiles, most frequent first. Types drawn the same way
 * (a ride and a virtual ride) share one tile, named after both.
 */
function SportTiles({
  sports,
  size,
}: {
  sports: string[];
  size: "row" | "card";
}) {
  const t = useT();
  const tiles: { type: string; labels: string[] }[] = [];
  for (const sport of sports) {
    const { icon, color } = getSportConfig(sport);
    const same = tiles.find((tile) => {
      const config = getSportConfig(tile.type);
      return config.icon === icon && config.color === color;
    });
    if (same) same.labels.push(sportTypeLabel(sport, t));
    else tiles.push({ type: sport, labels: [sportTypeLabel(sport, t)] });
  }
  // Past three tiles, the third makes room for the "+N" that sums up the rest.
  const shown =
    size === "card"
      ? tiles.slice(0, 1)
      : tiles.slice(0, tiles.length > MAX_SPORTS ? MAX_SPORTS - 1 : MAX_SPORTS);
  const rest = tiles.slice(shown.length);
  return (
    <span className="flex items-center gap-1">
      {shown.map((tile) => (
        <SportIconTile
          key={tile.type}
          type={tile.type}
          label={tile.labels.join(", ")}
          className={
            size === "card" ? "size-10 rounded-xl" : "size-7 rounded-md"
          }
          iconClassName={size === "card" ? "size-5" : "size-4"}
        />
      ))}
      {size === "row" && rest.length > 0 && (
        // Above the row's link, so its title shows the other sports on hover.
        <span
          className="text-muted-foreground relative pl-0.5 text-xs tabular-nums"
          title={rest.flatMap((tile) => tile.labels).join(", ")}
        >
          +{rest.length}
        </span>
      )}
    </span>
  );
}

function ViewMenu({
  view,
  folders,
  actions,
  presentations,
  trigger,
}: {
  view: SavedActivityView;
  folders: ViewFolder[];
  actions: SavedViewActions;
  /** Adds the Map and Charts links, for rows that have no room for them. */
  presentations?: boolean;
  trigger: React.ReactElement;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={trigger}
        aria-label={t("views.manageItem", { name: view.name })}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max min-w-44">
        {presentations && (
          <>
            {PRESENTATIONS.slice(1).map(({ id, label, icon: Icon }) => (
              <DropdownMenuLinkItem
                key={id}
                render={
                  <Link
                    href={actions.href(view, ACTIVITY_PRESENTATION_PATHS[id])}
                  />
                }
              >
                <Icon />
                {t(label)}
              </DropdownMenuLinkItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => actions.onRename(view)}>
          {t("views.rename")}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("views.moveTo")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-44">
            <DropdownMenuRadioGroup
              value={String(view.folderId ?? "")}
              onValueChange={(value: string) => {
                const folderId = value ? Number(value) : null;
                if (folderId !== view.folderId) actions.onMove(view, folderId);
              }}
            >
              <DropdownMenuRadioItem value="" closeOnClick>
                {t("views.ungrouped")}
              </DropdownMenuRadioItem>
              {folders.map((folder) => (
                <DropdownMenuRadioItem
                  key={folder.id}
                  value={String(folder.id)}
                  closeOnClick
                >
                  {folder.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={() => actions.onDuplicate(view)}>
          {t("views.duplicate")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => actions.onDelete(view)}
        >
          {t("common.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ListProps {
  groups: ViewGroup<SavedActivityView>[];
  stats: Record<number, SavedViewStats> | undefined;
  folders: ViewFolder[];
  today: string;
  busy: boolean;
  actions: SavedViewActions;
}

/**
 * The saved views as a table with the activity table's grammar. Each row
 * links to the view's list and can be dragged onto a folder of the sidebar.
 */
export function SavedViewTable({
  previewContainer,
  ...props
}: ListProps & { previewContainer: React.RefObject<HTMLElement | null> }) {
  const t = useT();
  const columns = [
    { label: t("views.listColumns.sport"), className: SPORTS_UP },
    { label: t("views.listColumns.view") },
    { label: t("views.listColumns.period"), className: PERIOD_UP },
    { label: t("views.listColumns.activities"), numeric: true },
    {
      label: t("views.listColumns.distance"),
      numeric: true,
      className: TOTALS_UP,
    },
    {
      label: t("views.listColumns.elevation"),
      numeric: true,
      className: TOTALS_UP,
    },
    { label: t("views.listColumns.time"), numeric: true, className: TOTALS_UP },
  ];
  return (
    <Table
      containerClassName="overflow-visible"
      className="text-muted-foreground text-left"
    >
      <TableHeader className="bg-accent sticky top-0 z-10 text-xs uppercase">
        <TableRow className={cn(COLUMNS, "border-border/60 hover:bg-accent")}>
          {columns.map((column) => (
            <TableHead
              key={column.label}
              className={cn(
                "text-muted-foreground flex h-10 items-center px-0 font-normal",
                column.numeric && "justify-end",
                column.className,
              )}
            >
              {column.label}
            </TableHead>
          ))}
          <TableHead className="h-10 px-0">
            <span className="sr-only">{t("views.manage")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      {props.groups.map((group) => (
        <TableBody key={group.key}>
          {group.label !== null && (
            <TableRow className="bg-muted hover:bg-muted flex h-9 items-center px-4">
              <TableHead
                colSpan={columns.length + 1}
                scope="rowgroup"
                className="text-foreground h-auto px-0"
              >
                {group.label}{" "}
                <span className="text-muted-foreground font-normal">
                  ({group.views.length})
                </span>
              </TableHead>
            </TableRow>
          )}
          {group.views.map((view) => (
            <SavedViewRow
              key={view.id}
              view={view}
              previewContainer={previewContainer}
              {...props}
            />
          ))}
        </TableBody>
      ))}
    </Table>
  );
}

function SavedViewRow({
  view,
  stats,
  folders,
  today,
  busy,
  actions,
  previewContainer,
}: ListProps & {
  view: SavedActivityView;
  previewContainer: React.RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const summary = useViewSummary(stats?.[view.id], today);
  return (
    <Draggable.Root
      kind={savedViewKind}
      payload={view}
      disabled={busy}
      render={<TableRow />}
      className={cn(
        COLUMNS,
        "border-border/60 relative h-12 data-dragging:opacity-40",
      )}
    >
      <TableCell className={cn("px-0", SPORTS_UP)}>
        {summary && <SportTiles sports={summary.sports} size="row" />}
      </TableCell>
      <TableCell className="min-w-0 px-0">
        {/* The link stretches over the row and is its drag handle: links
            can't start a drag otherwise, and a press that doesn't move still
            opens the view. */}
        <Draggable.Handle
          render={<Link href={actions.href(view)} />}
          className="text-foreground focus-visible:after:ring-ring block truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset"
        >
          {view.name}
        </Draggable.Handle>
      </TableCell>
      <TableCell className={cn("min-w-0 px-0", PERIOD_UP)}>
        <span className="truncate">{summary?.period}</span>
      </TableCell>
      <TableCell className="px-0 text-right tabular-nums">
        {summary?.count}
      </TableCell>
      <TableCell className={cn("justify-end px-0 tabular-nums", TOTALS_UP)}>
        {summary?.distance}
      </TableCell>
      <TableCell className={cn("justify-end px-0 tabular-nums", TOTALS_UP)}>
        {summary?.elevation}
      </TableCell>
      <TableCell className={cn("justify-end px-0 tabular-nums", TOTALS_UP)}>
        {summary?.time}
      </TableCell>
      <TableCell className="relative flex justify-end gap-0.5 px-0">
        {PRESENTATIONS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            nativeButton={false}
            render={
              <Link
                href={actions.href(view, ACTIVITY_PRESENTATION_PATHS[id])}
              />
            }
            aria-label={t("views.openAs", {
              presentation: t(label),
              name: view.name,
            })}
            title={t(label)}
          >
            <Icon />
          </Button>
        ))}
        <ViewMenu
          view={view}
          folders={folders}
          actions={actions}
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
            />
          }
        />
      </TableCell>
      <Draggable.Preview
        container={previewContainer}
        offset={({ container }) => ({
          x: container.getBoundingClientRect().width / 2,
          y: -8,
        })}
        className="bg-popover text-popover-foreground border-border pointer-events-none w-max max-w-64 truncate rounded-md border px-2.5 py-1.5 text-sm font-medium shadow-md"
      >
        {view.name}
      </Draggable.Preview>
    </Draggable.Root>
  );
}

/** The saved views as the activity list's mobile rows. Views move from the menu. */
export function SavedViewCards(props: ListProps) {
  return (
    <div>
      {props.groups.map((group) => (
        <section key={group.key} aria-label={group.label ?? undefined}>
          {group.label !== null && (
            <h3 className="bg-muted flex h-9 items-center px-4 text-sm font-medium">
              <span>
                {group.label}{" "}
                <span className="text-muted-foreground font-normal">
                  ({group.views.length})
                </span>
              </span>
            </h3>
          )}
          <ul>
            {group.views.map((view) => (
              <SavedViewCard key={view.id} view={view} {...props} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SavedViewCard({
  view,
  stats,
  folders,
  today,
  actions,
}: ListProps & { view: SavedActivityView }) {
  const t = useT();
  const summary = useViewSummary(stats?.[view.id], today);
  const sports = summary?.sports ?? [];
  const details = [
    sports.length > 0 &&
      sports
        .slice(0, 2)
        .map((sport) => sportTypeLabel(sport, t))
        .join(", ") + (sports.length > 2 ? ` +${sports.length - 2}` : ""),
    summary?.period,
  ].filter(Boolean);
  const numbers = summary
    ? [
        t("views.activityCount", {
          count: summary.activities,
          n: summary.count,
        }),
        summary.distance,
        summary.elevation,
        summary.time,
      ].filter(Boolean)
    : [];
  return (
    <li className="border-border/60 hover:bg-accent relative flex items-center gap-3 border-b py-3 pr-2 pl-4">
      {sports.length > 0 ? (
        <SportTiles sports={sports} size="card" />
      ) : (
        <span className="bg-muted size-10 shrink-0 rounded-xl" />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          href={actions.href(view)}
          className="focus-visible:after:ring-ring truncate text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset"
        >
          {view.name}
        </Link>
        {details.length > 0 && (
          <span className="text-muted-foreground truncate text-xs">
            {details.join(" · ")}
          </span>
        )}
        {numbers.length > 0 && (
          <span className="text-foreground/80 truncate text-xs tabular-nums">
            {numbers.join(" · ")}
          </span>
        )}
      </span>
      <ViewMenu
        view={view}
        folders={folders}
        actions={actions}
        presentations
        trigger={
          <Button
            variant="ghost"
            size="icon-lg"
            className="text-muted-foreground relative"
          />
        }
      />
    </li>
  );
}
