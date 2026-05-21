import * as React from "react";

import Link from "next/link";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/utils";

import { formatShortDate } from "./format";
import { RecordsEmptyState, getMedalClasses } from "./shared";
import { RecordControl, useRecordsExplorer } from "./useRecordsExplorer";

/**
 * "Personal bests" leaderboard.
 *
 * Large segmented controls span the top; the best result is called out in a banner
 * strip and every rank is laid out in a dense, full-width table.
 */
export function Records() {
  const {
    sportControl,
    metricControl,
    paramControl,
    paramLabel,
    entries,
    isLoading,
    emptyMessage,
  } = useRecordsExplorer();

  const [best] = entries;
  const hasSub = entries.some((e) => e.sub);

  return (
    <div className="flex flex-col gap-5">
      {/* Controls — restore the gutter the page drops on mobile (cards below
          stay edge-to-edge, but these aren't cards). */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 max-sm:px-3">
        {sportControl.items.length > 0 && (
          <ControlGroup label="Sport">
            <SegmentedToggle
              value={sportControl.selected ?? sportControl.items[0]?.key}
              onChange={sportControl.onSelect}
              options={sportControl.items.map((it) => ({
                value: it.key,
                label: it.label,
              }))}
            />
          </ControlGroup>
        )}
        <ControlGroup label="Metric">
          <SegmentedToggle
            value={String(metricControl.selected ?? "")}
            onChange={(v) => metricControl.onSelect(v)}
            options={metricControl.items.map((it) => ({
              value: String(it.key),
              label: it.label,
            }))}
          />
        </ControlGroup>
        {paramControl && (
          <ControlGroup label={paramLabel}>
            <ParamSelect control={paramControl} />
          </ControlGroup>
        )}
      </div>

      {isLoading ? (
        <RecordsEmptyState message="Loading…" />
      ) : entries.length === 0 ? (
        <RecordsEmptyState message={emptyMessage} />
      ) : (
        <div className="flex flex-col gap-4">
          {best && (
            <Link
              href={`/activities/${best.stravaId}`}
              className="bg-muted/40 hover:bg-muted/70 flex flex-col gap-3 rounded-xl px-5 py-4 transition-colors sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex items-center gap-4">
                <span className="bg-amber-500/20 text-amber-500 flex size-10 shrink-0 items-center justify-center rounded-full text-base font-bold">
                  1
                </span>
                <div className="flex flex-col">
                  <span className="text-foreground font-mono text-3xl font-bold whitespace-nowrap">
                    {best.value}
                  </span>
                  {best.sub && (
                    <span className="text-muted-foreground text-sm">
                      {best.sub}
                    </span>
                  )}
                </div>
              </div>
              <div className="min-w-0 sm:ml-auto sm:text-right">
                <div className="text-foreground truncate text-sm font-medium">
                  {best.name}
                </div>
                <div className="text-muted-foreground text-xs">
                  {formatShortDate(best.date)}
                </div>
              </div>
            </Link>
          )}

          <div className="bg-card rounded-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center">#</TableHead>
                  <TableHead>Result</TableHead>
                  {hasSub && <TableHead>Avg</TableHead>}
                  <TableHead>Activity</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e, i) => {
                  const rank = i + 1;
                  return (
                    <TableRow key={e.stravaId}>
                      <TableCell className="text-center">
                        <span
                          className={cn(
                            "inline-flex size-7 items-center justify-center rounded-full text-xs font-bold",
                            getMedalClasses(rank),
                          )}
                        >
                          {rank}
                        </span>
                      </TableCell>
                      <TableCell className="text-foreground font-mono text-base font-bold">
                        {e.value}
                      </TableCell>
                      {hasSub && (
                        <TableCell className="text-muted-foreground">
                          {e.sub ?? "—"}
                        </TableCell>
                      )}
                      <TableCell className="min-w-52 max-w-none sm:min-w-0 sm:max-w-0">
                        <Link
                          href={`/activities/${e.stravaId}`}
                          className="text-foreground hover:text-primary block font-medium sm:truncate"
                        >
                          {e.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right">
                        {formatShortDate(e.date)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function ControlGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

function ParamSelect<T extends string | number>({
  control,
}: {
  control: RecordControl<T>;
}) {
  const selectItems = control.items.map((it) => ({
    value: String(it.key),
    label: it.label,
  }));
  return (
    <Select
      items={selectItems}
      value={control.selected == null ? "" : String(control.selected)}
      onValueChange={(v) => {
        const item = control.items.find((it) => String(it.key) === v);
        if (item) control.onSelect(item.key);
      }}
    >
      <SelectTrigger size="sm" className="h-8 text-xs">
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent>
        {control.items.map((item) => (
          <SelectItem key={String(item.key)} value={String(item.key)}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
