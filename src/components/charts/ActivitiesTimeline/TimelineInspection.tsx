import * as React from "react";

import { format, parseISO } from "date-fns";
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { createPortal } from "react-dom";

import { PreviewCard } from "@base-ui/react/preview-card";

import { ActivityPreviewHost } from "~/components/journal/ActivityPreviewCard";
import { ActivityBlock } from "~/components/journal/JournalDayCell";
import {
  type JournalPreviewHandles,
  JournalPreviewProvider,
} from "~/components/journal/journalPreview";
import type { JournalActivity } from "~/components/journal/useJournalWeeks";
import { Button } from "~/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "~/components/ui/drawer";
import { useIsMobile } from "~/hooks/useIsMobile";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { activityHref } from "~/utils/activityLinks";
import { getSportConfig } from "~/utils/sportConfig";

import { useTimelineInspectionContainer } from "./TimelineInspectionLayout";

export interface TimelineContribution {
  activity: JournalActivity;
  value: number | null;
}

export function TimelineInspection({
  title,
  source,
  metricLabel,
  sport,
  sports,
  rows,
  formatValue,
  onSportChange,
  onClose,
  onPrevious,
  onNext,
  onShowAll,
  returnHref,
  listHref,
  returnFocus,
}: {
  title: string;
  source: string;
  metricLabel: string;
  sport?: string;
  sports: string[];
  rows: TimelineContribution[];
  formatValue: (value: number | null) => string;
  onSportChange: (sport?: string) => void;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onShowAll?: () => void;
  returnHref: string;
  listHref?: string;
  returnFocus: React.RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const container = useTimelineInspectionContainer();
  const [handles] = React.useState<JournalPreviewHandles>(() => ({
    activity: PreviewCard.createHandle(),
  }));
  const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const missing = rows.filter((row) => row.value === null).length;
  const close = () => {
    onClose();
    returnFocus.current?.focus({ preventScroll: true });
  };
  React.useEffect(() => {
    if (isMobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !(
          event.target instanceof Element &&
          event.target.closest(
            '[role="dialog"], [role="listbox"], [role="menu"], [data-slot="select-content"], [data-slot="popover-content"], [data-slot="preview-card-content"]',
          )
        )
      ) {
        onClose();
        returnFocus.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobile, onClose, returnFocus]);

  const body = (
    <JournalPreviewProvider value={handles}>
      <div className="flex items-start gap-2 px-4 pt-4">
        <div className="min-w-0 flex-1">
          {isMobile ? (
            <DrawerTitle>{title}</DrawerTitle>
          ) : (
            <h2 className="font-semibold">{title}</h2>
          )}
          <p className="text-muted-foreground mt-1 text-xs">{source}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-8"
          disabled={!onPrevious}
          onClick={onPrevious}
          aria-label={t("charts.activitiesTimeline.previous")}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-8"
          disabled={!onNext}
          onClick={onNext}
          aria-label={t("charts.activitiesTimeline.next")}
        >
          <ChevronRightIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-8"
          onClick={close}
          aria-label={t("common.close")}
        >
          <XIcon />
        </Button>
      </div>
      <div className="px-4 py-3">
        <p className="text-muted-foreground mb-1 text-xs">{metricLabel}</p>
        <div className="flex items-baseline gap-2" aria-live="polite">
          <strong className="text-2xl tabular-nums">
            {missing === rows.length && missing > 0
              ? t("charts.activitiesTimeline.unavailable")
              : formatValue(total)}
          </strong>
          <span className="text-muted-foreground text-sm">
            {t("views.activities", { count: rows.length })}
          </span>
        </div>
        <div
          className="mt-3 flex flex-wrap gap-1"
          role="group"
          aria-label={t("charts.activitiesTimeline.sports")}
        >
          <Button
            size="sm"
            variant={!sport ? "secondary" : "outline"}
            className="min-h-11 md:min-h-8"
            aria-pressed={!sport}
            onClick={() => onSportChange()}
          >
            {t("charts.activitiesTimeline.allSports")}
          </Button>
          {sports.map((type) => (
            <Button
              key={type}
              size="sm"
              variant={sport === type ? "secondary" : "outline"}
              className="min-h-11 gap-1 md:min-h-8"
              aria-pressed={sport === type}
              onClick={() => onSportChange(type)}
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: getSportConfig(type).color }}
              />
              {sportTypeLabel(type, t)}
            </Button>
          ))}
        </div>
        {onShowAll && (
          <Button
            variant="link"
            size="sm"
            className="mt-1 px-0"
            onClick={onShowAll}
          >
            {t("charts.activitiesTimeline.restoreSports")}
          </Button>
        )}
        {missing > 0 && (
          <p className="text-muted-foreground mt-3 text-xs">
            {t("charts.activitiesTimeline.missing", { count: missing })}
          </p>
        )}
      </div>
      <ContributionList
        key={`${title}:${sport}`}
        rows={rows}
        total={total}
        formatValue={formatValue}
        returnHref={returnHref}
      />
      <div className="border-border shrink-0 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-12">
        <Button
          nativeButton={false}
          render={<Link href={listHref ?? "#"} />}
          disabled={!listHref}
          className="w-full"
        >
          {t("charts.activitiesTimeline.openList")}
          <ArrowRightIcon />
        </Button>
        {!listHref && (
          <p className="text-muted-foreground mt-2 text-xs">
            {t("charts.activitiesTimeline.cannotOpen")}
          </p>
        )}
      </div>
      <ActivityPreviewHost handle={handles.activity} />
    </JournalPreviewProvider>
  );

  return isMobile ? (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        className="max-h-[90svh] gap-0 overflow-hidden px-0 pb-0 [&>div:first-child]:mb-0 [&>div:last-child]:gap-0"
        showCloseButton={false}
        finalFocus={returnFocus}
      >
        {body}
      </DrawerContent>
    </Drawer>
  ) : container ? (
    createPortal(
      <section
        aria-label={t("charts.activitiesTimeline.inspection")}
        className="flex min-h-0 w-full flex-col"
      >
        {body}
      </section>,
      container,
    )
  ) : null;
}

function ContributionList({
  rows,
  total,
  formatValue,
  returnHref,
}: {
  rows: TimelineContribution[];
  total: number;
  formatValue: (value: number | null) => string;
  returnHref: string;
}) {
  const t = useT();
  const [visible, setVisible] = React.useState(50);
  const sorted = React.useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (b.value ?? -Infinity) - (a.value ?? -Infinity) ||
          b.activity.startDateLocal.localeCompare(a.activity.startDateLocal),
      ),
    [rows],
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <ul className="space-y-3">
        {sorted.slice(0, visible).map(({ activity, value }) => (
          <li key={activity.stravaId}>
            <p className="text-muted-foreground mb-1 text-xs">
              {format(parseISO(activity.startDateLocal), "d MMM yyyy", {
                locale: getActiveDateLocale(),
              })}
            </p>
            <div
              className="relative rounded-md border-l-2"
              style={{ borderColor: getSportConfig(activity.type).color }}
            >
              <ActivityBlock
                activity={activity}
                href={activityHref(activity.stravaId, returnHref)}
                variant="card"
                className="pr-24"
              />
              <div className="pointer-events-none absolute top-3 right-3 max-w-24 text-right text-sm font-semibold tabular-nums">
                {value === null ? "—" : formatValue(value)}
                <p className="text-muted-foreground text-xs font-normal">
                  {value === null
                    ? t("charts.activitiesTimeline.unavailable")
                    : `${total ? Math.round((value / total) * 100) : 0}%`}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!rows.length && (
        <p className="text-muted-foreground py-6 text-sm">
          {t("charts.activitiesTimeline.empty")}
        </p>
      )}
      {rows.length > visible && (
        <Button
          variant="outline"
          className="mt-3 w-full"
          onClick={() => setVisible(visible + 50)}
        >
          {t("charts.activitiesTimeline.more", {
            count: rows.length - visible,
          })}
        </Button>
      )}
    </div>
  );
}
