import * as React from "react";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

import { QueryState } from "~/components/primitives/QueryState";
import { Button } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { useIsMobile } from "~/hooks/useIsMobile";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { activityHref } from "~/utils/activityLinks";
import { getSportConfig } from "~/utils/sportConfig";

import {
  type Entry,
  type RecordsExplorer,
  type Result,
  type Sport,
  useRecordsExplorer,
} from "./useRecordsExplorer";

const SPORT_TYPE: Record<Sport, string> = { cycling: "Ride", running: "Run" };

/**
 * "Personal bests": the leaderboard of one category in a table with the
 * activity table's grammar. The toolbar picks the sport, the metric and its
 * duration or distance, whose list shows every all-time best of the metric.
 * On mobile, like the Activities view bar, it folds into one button.
 */
export function Records() {
  const explorer = useRecordsExplorer();
  const isMobile = useIsMobile();
  const t = useT();
  const [drawer, setDrawer] = React.useState(false);
  const { entries } = explorer;
  const SportIcon = getSportConfig(SPORT_TYPE[explorer.sport]).icon;
  return (
    <>
      <div className="border-border bg-background shrink-0 border-b">
        {isMobile ? (
          <ToolbarPrimitive.Root
            aria-label={t("charts.records.categories")}
            className="flex min-w-0 items-center gap-2 px-3 py-2"
          >
            <ToolbarPrimitive.Button
              render={<Button variant="ghost" />}
              aria-haspopup="dialog"
              aria-expanded={drawer}
              className="h-10 min-w-0 flex-1 justify-start px-1 text-left"
              onClick={() => setDrawer(true)}
            >
              <SportIcon aria-hidden className="text-muted-foreground" />
              <span className="sr-only">
                {t(`sport.${explorer.sport}.label`)},
              </span>
              <span className="truncate">{explorer.title}</span>
              <ChevronDownIcon className="text-muted-foreground ml-auto" />
            </ToolbarPrimitive.Button>
          </ToolbarPrimitive.Root>
        ) : (
          <ToolbarPrimitive.Root
            aria-label={t("charts.records.categories")}
            className="flex flex-wrap items-center gap-2 px-4 py-3"
          >
            {explorer.sports.length > 1 && (
              <SportSwitch explorer={explorer} toolbar />
            )}
            <GroupSelect explorer={explorer} toolbar className="w-52" />
            <CategorySelect explorer={explorer} className="w-52" />
          </ToolbarPrimitive.Root>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {explorer.isError ? (
          <QueryState error onRetry={explorer.retry} />
        ) : explorer.isLoading ? (
          <QueryState loading />
        ) : entries.length === 0 ? (
          <QueryState>
            <p>{explorer.emptyMessage}</p>
          </QueryState>
        ) : (
          <div
            aria-busy={explorer.isRefreshing}
            // The previous rows stay, dimmed and out of reach, while the new
            // category loads.
            inert={explorer.isRefreshing}
            className={cn(
              "transition-opacity",
              explorer.isRefreshing && "opacity-50",
            )}
          >
            {isMobile ? (
              <LeaderboardCards entries={entries} />
            ) : (
              <LeaderboardTable entries={entries} />
            )}
          </div>
        )}
      </div>
      {isMobile && (
        <RecordsDrawer
          explorer={explorer}
          open={drawer}
          onOpenChange={setDrawer}
        />
      )}
    </>
  );
}

/** The metric: power, speed, heart rate, climbing or volume for rides. */
function GroupSelect({
  explorer,
  toolbar = false,
  className,
}: {
  explorer: RecordsExplorer;
  /** Joins the toolbar's arrow-key navigation. */
  toolbar?: boolean;
  className?: string;
}) {
  const t = useT();
  const label = t("charts.records.metric");
  return (
    <Select
      items={explorer.groups.map((group) => ({
        value: group.key,
        label: group.label,
      }))}
      value={explorer.group.key}
      onValueChange={(key) => {
        const group = explorer.groups.find((g) => g.key === key);
        if (group) explorer.selectGroup(group);
      }}
    >
      {toolbar ? (
        <ToolbarPrimitive.Button
          render={<SelectTrigger className={cn("min-w-0", className)} />}
          aria-label={label}
        >
          <SelectValue />
        </ToolbarPrimitive.Button>
      ) : (
        <SelectTrigger className={cn("min-w-0", className)} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
      )}
      <SelectContent>
        {explorer.groups.map((group) => (
          <SelectItem key={group.key} value={group.key}>
            {group.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The metric's durations or distances, each with its all-time best. */
function CategorySelect({
  explorer,
  className,
}: {
  explorer: RecordsExplorer;
  className?: string;
}) {
  const t = useT();
  const { categories } = explorer.group;
  return (
    <Select
      items={categories.map((category) => ({
        value: category.id,
        label: category.label,
      }))}
      value={explorer.selectedId}
      onValueChange={(id) => {
        const category = categories.find((c) => c.id === id);
        if (category) explorer.select(category);
      }}
    >
      <ToolbarPrimitive.Button
        render={<SelectTrigger className={cn("min-w-0", className)} />}
        aria-label={t("charts.records.category")}
      >
        <SelectValue />
      </ToolbarPrimitive.Button>
      <SelectContent className="max-h-96">
        {categories.map((category) => (
          <SelectItem key={category.id} value={category.id}>
            {category.label}
            <Best
              result={category.best}
              known={explorer.bestsKnown}
              className="ml-auto pl-6"
            />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A category's all-time best, muted: a dash once the bests are known to have
 * none, nothing while they load.
 */
function Best({
  result,
  known,
  className,
}: {
  result: Result | null;
  known: boolean;
  className?: string;
}) {
  if (!result && !known) return null;
  return result ? (
    <ResultText
      result={result}
      className={cn("text-muted-foreground text-xs", className)}
      unitClassName="ml-0.5 text-[10px]"
    />
  ) : (
    <span className={cn("text-muted-foreground/60 text-xs", className)}>—</span>
  );
}

/**
 * The toolbar of mobile in a bottom drawer: the sport and the metric, then
 * every duration or distance with its all-time best. Picking one closes it.
 */
function RecordsDrawer({
  explorer,
  open,
  onOpenChange,
}: {
  explorer: RecordsExplorer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const selectedRef = React.useRef<HTMLButtonElement>(null);
  // Long lists (16 durations) can hide the selected one below the fold.
  React.useEffect(() => {
    if (open) selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);
  return (
    // Kept mounted so that closing returns focus to the toolbar button.
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[85dvh] flex-col gap-3 px-4">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("charts.records.categories")}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="flex flex-col gap-2">
          {explorer.sports.length > 1 && (
            <SportSwitch explorer={explorer} labelled className="h-10" />
          )}
          <GroupSelect explorer={explorer} className="w-full" />
        </div>
        <nav
          aria-label={explorer.group.label}
          className="border-border -mx-4 flex min-h-0 flex-col overflow-y-auto border-t px-4 pt-2 pb-2"
        >
          {explorer.group.categories.map((category) => {
            const active = category.id === explorer.selectedId;
            return (
              <button
                key={category.id}
                ref={active ? selectedRef : undefined}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  explorer.select(category);
                  onOpenChange(false);
                }}
                className={cn(
                  "hover:bg-accent focus-visible:ring-ring flex h-11 shrink-0 items-center gap-3 rounded-md px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset",
                  active
                    ? "text-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {category.label}
                </span>
                <Best result={category.best} known={explorer.bestsKnown} />
                <CheckIcon
                  className={cn("text-primary size-4", !active && "invisible")}
                />
              </button>
            );
          })}
        </nav>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function SportSwitch({
  explorer,
  labelled = false,
  toolbar = false,
  className,
}: {
  explorer: RecordsExplorer;
  /** Name each sport next to its icon; otherwise only screen readers read it. */
  labelled?: boolean;
  /** Joins the toolbar's arrow-key navigation instead of adding tab stops. */
  toolbar?: boolean;
  className?: string;
}) {
  const t = useT();
  const Group = toolbar ? ToolbarToggleGroup : ToggleGroup;
  const Item = toolbar ? ToolbarToggle : Toggle;
  return (
    <Group
      aria-label={t("charts.records.sport")}
      value={[explorer.sport]}
      onValueChange={(next) => {
        // A sport is always selected: ignore un-pressing the active one.
        const selected = next[0] as Sport | undefined;
        if (selected) explorer.selectSport(selected);
      }}
      className={cn(
        "bg-muted flex h-9 shrink-0 items-center rounded-md p-1",
        className,
      )}
    >
      {explorer.sports.map((sport) => {
        const Icon = getSportConfig(SPORT_TYPE[sport]).icon;
        const label = t(`sport.${sport}.label`);
        return (
          <Item
            key={sport}
            value={sport}
            aria-label={labelled ? undefined : label}
            title={labelled ? undefined : label}
            className="text-muted-foreground hover:text-foreground data-pressed:bg-background data-pressed:text-foreground focus-visible:ring-ring/50 flex h-full flex-1 items-center justify-center gap-1.5 rounded px-2.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 data-pressed:shadow-sm"
          >
            <Icon aria-hidden className="size-4" />
            {labelled && label}
          </Item>
        );
      })}
    </Group>
  );
}

/** A toggle group that is also a group of the surrounding toolbar. */
function ToolbarToggleGroup(props: React.ComponentProps<typeof ToggleGroup>) {
  return <ToolbarPrimitive.Group render={<ToggleGroup {...props} />} />;
}

/** A toggle that the surrounding toolbar's arrow keys reach. */
function ToolbarToggle(props: React.ComponentProps<typeof Toggle>) {
  return <ToolbarPrimitive.Button render={<Toggle {...props} />} />;
}

function ResultText({
  result,
  className,
  unitClassName,
}: {
  result: Result;
  className?: string;
  unitClassName?: string;
}) {
  return (
    <span className={cn("tabular-nums", className)}>
      {result.value}
      {result.unit && (
        <span
          className={cn(
            "text-muted-foreground ml-1 text-xs font-normal",
            unitClassName,
          )}
        >
          {result.unit}
        </span>
      )}
    </span>
  );
}

/** Whether the rows mix activity types, e.g. outdoor and virtual rides. */
const mixesTypes = (entries: Entry[]) =>
  new Set(entries.map((entry) => entry.type)).size > 1;

function LeaderboardTable({ entries }: { entries: Entry[] }) {
  const t = useT();
  const { asPath } = useRouter();
  const hasSub = entries.some((entry) => entry.sub);
  const types = mixesTypes(entries);
  // One template for the header and every row, so the columns line up.
  const columns = [
    "2.5rem",
    "6.5rem",
    hasSub && "6rem",
    "minmax(0,1fr)",
    types && "9rem",
    "8rem",
  ]
    .filter(Boolean)
    .join(" ");
  const row = "grid items-center gap-x-4 px-4";
  const head = "text-muted-foreground flex h-10 items-center px-0 font-normal";
  return (
    <Table
      containerClassName="overflow-visible"
      className="text-muted-foreground text-left"
    >
      <TableHeader className="bg-accent sticky top-0 z-10 text-xs uppercase">
        <TableRow
          className={cn(row, "border-border/60 hover:bg-accent")}
          style={{ gridTemplateColumns: columns }}
        >
          <TableHead className={cn(head, "justify-end")}>#</TableHead>
          <TableHead className={cn(head, "justify-end")}>
            {t("charts.records.result")}
          </TableHead>
          {hasSub && (
            <TableHead className={cn(head, "justify-end")}>
              {t("charts.records.avg")}
            </TableHead>
          )}
          <TableHead className={head}>{t("charts.records.activity")}</TableHead>
          {types && (
            <TableHead className={head}>{t("charts.records.type")}</TableHead>
          )}
          <TableHead className={cn(head, "justify-end")}>
            {t("charts.records.date")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const best = entry.rank === 1;
          return (
            <TableRow
              key={entry.stravaId}
              className={cn(row, "border-border/60 relative h-12")}
              style={{ gridTemplateColumns: columns }}
            >
              <TableCell
                className={cn(
                  "px-0 text-right tabular-nums",
                  best && "text-foreground",
                )}
              >
                {entry.rank}
              </TableCell>
              <TableCell className="px-0 text-right">
                <ResultText
                  result={entry.result}
                  className={cn(
                    "text-foreground",
                    best ? "font-semibold" : "font-medium",
                  )}
                />
              </TableCell>
              {hasSub && (
                <TableCell className="px-0 text-right tabular-nums">
                  {entry.sub}
                </TableCell>
              )}
              <TableCell className="min-w-0 truncate px-0">
                <Link
                  href={activityHref(entry.stravaId, asPath)}
                  className="text-foreground focus-visible:after:ring-ring outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset"
                >
                  {entry.name}
                </Link>
              </TableCell>
              {types && (
                <TableCell className="truncate px-0">
                  {sportTypeLabel(entry.type, t)}
                </TableCell>
              )}
              <TableCell className="px-0 text-right">{entry.date}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** The leaderboard as the activity list's mobile rows. */
function LeaderboardCards({ entries }: { entries: Entry[] }) {
  const t = useT();
  const { asPath } = useRouter();
  const types = mixesTypes(entries);
  return (
    <ol>
      {entries.map((entry) => {
        const best = entry.rank === 1;
        return (
          <li
            key={entry.stravaId}
            className="border-border/60 hover:bg-accent relative flex min-h-16 items-center gap-3 border-b py-3 pr-4 pl-2"
          >
            <span
              className={cn(
                "w-6 shrink-0 text-right text-sm tabular-nums",
                best ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {entry.rank}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Link
                href={activityHref(entry.stravaId, asPath)}
                className="focus-visible:after:ring-ring truncate text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset"
              >
                {entry.name}
              </Link>
              <span className="text-muted-foreground truncate text-xs">
                {entry.date}
                {types && ` · ${sportTypeLabel(entry.type, t)}`}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              <ResultText
                result={entry.result}
                className={cn(
                  "text-sm",
                  best ? "font-semibold" : "font-medium",
                )}
              />
              {entry.sub && (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {entry.sub}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
