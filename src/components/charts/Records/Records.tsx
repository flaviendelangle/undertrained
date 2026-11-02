import * as React from "react";

import Link from "next/link";
import { useRouter } from "next/router";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

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
import { activityHref } from "~/utils/activityLinks";

import { formatShortDate } from "./format";
import { RecordsEmptyState, getMedalClasses } from "./shared";
import {
  type RecordControl,
  type RecordsExplorer,
  useRecordsExplorer,
} from "./useRecordsExplorer";

/**
 * "Personal bests" leaderboard.
 *
 * The controls sit in a toolbar under the page header, like the Activities
 * view bar. Below it, the best result is called out in a banner strip and
 * every rank is laid out in a dense, full-width table.
 */
export function Records() {
  const t = useT();
  const { asPath } = useRouter();
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
    <>
      <RecordsToolbar
        sportControl={sportControl}
        metricControl={metricControl}
        paramControl={paramControl}
        paramLabel={paramLabel}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 max-sm:px-0 sm:p-6">
        <div className="mx-auto w-full max-w-6xl">
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
                  href={activityHref(best.stravaId, asPath)}
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
                      {hasSub && (
                        <TableHead>{t("charts.records.avg")}</TableHead>
                      )}
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
                              href={activityHref(e.stravaId, asPath)}
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
      </div>
    </>
  );
}

/**
 * Sport, metric and duration/distance pickers, laid out like the Activities
 * view bar: one Base UI toolbar (arrow keys move between controls) whose
 * controls all share the `h-9` height. On mobile it stays a single row, with
 * the two pickers sharing the width left next to the sport switch.
 */
function RecordsToolbar({
  sportControl,
  metricControl,
  paramControl,
  paramLabel,
}: Pick<
  RecordsExplorer,
  "sportControl" | "metricControl" | "paramControl" | "paramLabel"
>) {
  const t = useT();
  const sports = sportControl.items;
  const sport = sportControl.selected ?? sports[0]?.key;
  return (
    <ToolbarPrimitive.Root
      aria-label={t("charts.records.options")}
      className="border-border bg-background flex min-w-0 shrink-0 items-center gap-2 border-b px-3 py-2 md:flex-wrap md:px-4 md:py-3"
    >
      {sports.length > 0 && sport != null && (
        <ToggleGroup
          aria-label={t("charts.records.sport")}
          value={[sport]}
          onValueChange={(next) => {
            // A sport is always selected: ignore un-pressing the active one.
            const selected = next[0];
            if (selected) sportControl.onSelect(selected);
          }}
          className="bg-muted flex h-9 shrink-0 items-center rounded-md p-1"
        >
          {sports.map((item) => (
            <Toggle
              key={item.key}
              value={item.key}
              className="text-muted-foreground hover:text-foreground data-pressed:bg-background data-pressed:text-foreground focus-visible:ring-ring/50 flex h-full items-center rounded px-2.5 transition-colors outline-none focus-visible:ring-3 data-pressed:shadow-sm"
            >
              {item.label}
            </Toggle>
          ))}
        </ToggleGroup>
      )}
      <RecordSelect
        control={metricControl}
        label={t("charts.records.metric")}
        className="md:w-48"
      />
      {paramControl && (
        <RecordSelect
          control={paramControl}
          label={paramLabel}
          className="md:w-36"
        />
      )}
    </ToolbarPrimitive.Root>
  );
}

function RecordSelect<T extends string | number>({
  control,
  label,
  className,
}: {
  control: RecordControl<T>;
  /** Accessible name: the toolbar shows the value only, like the view picker. */
  label: string;
  className?: string;
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
      <ToolbarPrimitive.Button
        render={<SelectTrigger />}
        aria-label={label}
        // Mobile: size from the content, then share the row's leftover width.
        className={cn("min-w-0 flex-auto md:flex-none", className)}
      >
        <SelectValue placeholder={t("charts.records.selectPlaceholder")} />
      </ToolbarPrimitive.Button>
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
