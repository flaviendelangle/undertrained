import { CardTitle } from "~/components/primitives/CardTitle";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import type { RiderSettingsTimeline } from "~/sensors/types";

import { RIDER_FIELD_CONFIG } from "../fieldConfig";
import { METRIC_ROW_GRID, MetricRow } from "./MetricRow";

const LABEL_CLASS =
  "text-muted-foreground text-xs tracking-wider whitespace-nowrap uppercase";

interface RiderProfileProps {
  timeline: RiderSettingsTimeline;
  onTimelineChange: (timeline: RiderSettingsTimeline) => void;
  hasSettings: boolean;
}

/**
 * The athlete's time-varying metrics as one table: a row per metric with its
 * value in force, and its dated history a click away.
 */
export function RiderProfile({
  timeline,
  onTimelineChange,
  hasSettings,
}: RiderProfileProps) {
  const t = useT();
  return (
    <section className="md:border-border md:bg-card px-5 pt-5 pb-2 md:rounded-sm md:border">
      <CardTitle description={t("settings.profile.description")}>
        {t("settings.profile.title")}
      </CardTitle>

      <div className={cn(METRIC_ROW_GRID, "pb-2 max-lg:hidden")} aria-hidden>
        <span className={LABEL_CLASS}>
          {t("settings.metric.column.metric")}
        </span>
        <span className={LABEL_CLASS}>{t("settings.metric.column.value")}</span>
        <span className={LABEL_CLASS}>{t("settings.metric.column.since")}</span>
        <span className={LABEL_CLASS}>
          {t("settings.metric.column.change")}
        </span>
      </div>

      {RIDER_FIELD_CONFIG.map((config) => (
        <MetricRow
          key={config.field}
          config={config}
          timeline={timeline}
          onTimelineChange={onTimelineChange}
          hasSettings={hasSettings}
        />
      ))}
    </section>
  );
}
