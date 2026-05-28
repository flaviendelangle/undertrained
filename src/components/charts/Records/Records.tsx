import * as React from "react";

import Link from "next/link";

import { SegmentedToggle } from "~/components/ui/segmented-toggle";
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
import { useT } from "~/i18n/useT";
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
  const t = useT();
  const {
    sportControl,
    metricControl,
    paramControl,
    paramLabel,
    entries,
    isLoading,
    isRefreshing,
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
          <ControlGroup label={t("charts.records.sport")}>
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
        <ControlGroup label={t("charts.records.metric")}>
          <ParamSelect control={metricControl} />
        </ControlGroup>
        {paramControl && (
          <ControlGroup label={paramLabel}>
            <ParamSelect control={paramControl} />
          </ControlGroup>
        )}
      </div>

      {isLoading ? (
        <RecordsEmptyState message={t("common.loading")} />
      ) : entries.length === 0 ? (
        <RecordsEmptyState message={emptyMessage} />
      ) : (
        <div
          className={cn(
            "flex flex-col gap-4 transition-opacity",
            // Dim the previous table while the new selection loads.
            isRefreshing && "pointer-events-none opacity-50",
          )}
        >
          {best && (
            <Link
              href={`/activities/${best.stravaId}`}
              className="bg-muted/40 hover:bg-muted/70 flex min-h-22 flex-col justify-center gap-3 px-5 py-4 transition-colors sm:flex-row sm:items-center sm:gap-4 sm:rounded-xl"
            >
              <div className="flex items-center gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-base font-bold text-amber-500">
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

          <div className="sm:bg-card sm:rounded-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center">#</TableHead>
                  <TableHead>{t("charts.records.result")}</TableHead>
                  {hasSub && <TableHead>{t("charts.records.avg")}</TableHead>}
                  <TableHead>{t("charts.records.activity")}</TableHead>
                  <TableHead className="text-right">
                    {t("charts.records.date")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e, i) => {
                  const rank = i + 1;
                  return (
                    <TableRow key={e.stravaId} className="h-12">
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
                      <TableCell className="max-w-none min-w-52 sm:w-full sm:max-w-0 sm:min-w-0 sm:truncate">
                        <Link
                          href={`/activities/${e.stravaId}`}
                          className="text-foreground hover:text-primary font-medium"
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
  const t = useT();
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
        <SelectValue placeholder={t("charts.records.selectPlaceholder")} />
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
