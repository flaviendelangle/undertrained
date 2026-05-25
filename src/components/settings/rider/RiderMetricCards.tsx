import type { RiderSettingsTimeline } from "~/sensors/types";

import { FIELD_DOMAINS } from "../fieldDomains";
import { MetricCard } from "./MetricCard";

interface RiderMetricCardsProps {
  timeline: RiderSettingsTimeline;
  onTimelineChange: (timeline: RiderSettingsTimeline) => void;
  hasSettings: boolean;
}

/**
 * Rider Settings — one top-level card per metric, matching the other settings
 * sections (full-bleed on mobile, boxed on desktop). Cards are grouped one line
 * per domain; multi-metric domains (heart rate) sit side by side on desktop and
 * stack on mobile. Emitted as a fragment so each line is a direct child of the
 * settings page's section list (inheriting its dividers / spacing).
 */
export function RiderMetricCards({
  timeline,
  onTimelineChange,
  hasSettings,
}: RiderMetricCardsProps) {
  return (
    <>
      {FIELD_DOMAINS.map((domain) => {
        if (domain.fields.length === 1) {
          return (
            <MetricCard
              key={domain.id}
              config={domain.fields[0]}
              timeline={timeline}
              onTimelineChange={onTimelineChange}
              hasSettings={hasSettings}
            />
          );
        }

        // Multi-metric domain (heart rate): a single line of side-by-side cards.
        return (
          <div
            key={domain.id}
            className="divide-border flex flex-col divide-y md:flex-row md:gap-6 md:divide-y-0"
          >
            {domain.fields.map((config) => (
              <MetricCard
                key={config.field}
                config={config}
                timeline={timeline}
                onTimelineChange={onTimelineChange}
                hasSettings={hasSettings}
                className="md:flex-1"
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
