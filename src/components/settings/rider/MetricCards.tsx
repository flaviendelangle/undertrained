import type { RiderSettingsTimeline } from "~/sensors/types";

import { FIELD_DOMAINS } from "../fieldDomains";
import { MetricCard } from "./MetricCard";

interface MetricCardsProps {
  timeline: RiderSettingsTimeline;
  onTimelineChange: (timeline: RiderSettingsTimeline) => void;
  hasSettings: boolean;
}

/**
 * Proposal A — metric-first cards. One card per time-varying field, grouped by
 * athletic domain. Each card carries its own current value, trend, sparkline,
 * and inline-editable history.
 */
export function MetricCards({
  timeline,
  onTimelineChange,
  hasSettings,
}: MetricCardsProps) {
  return (
    <div className="flex flex-col gap-6">
      {FIELD_DOMAINS.map((domain) => (
        <div key={domain.id} className="flex flex-col gap-2">
          <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {domain.label}
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {domain.fields.map((config) => (
              <MetricCard
                key={config.field}
                config={config}
                timeline={timeline}
                onTimelineChange={onTimelineChange}
                hasSettings={hasSettings}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
