import * as React from "react";

import { ActivityIcon, BarChart3Icon, LayersIcon } from "lucide-react";

import { FeatureHint } from "~/components/primitives/FeatureHint";
import { ChartCard } from "~/components/ui/chart-card";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
import {
  activitySettingsDay,
  useActivityRecording,
} from "~/lib/activityRecording";
import { trpc } from "~/utils/trpc";

import { ChartMessage } from "../ChartMessage";
import {
  ChartSettingsPopover,
  SliceWidthSettings,
  iconTabOption,
} from "../shared/chartSettings";
import { createSliceWidthStore } from "../shared/createSliceWidthStore";
import { PaceOverTime } from "./PaceOverTime";
import { PaceSliceDistribution } from "./PaceSliceDistribution";
import { PaceZoneDistribution } from "./PaceZoneDistribution";

type PaceTab = "timeline" | "zones" | "distribution";

/** Width (seconds per kilometre) of each bar in the Distribution histogram. */
const paceSliceWidth = createSliceWidthStore({
  storageKey: "undertrained:pace-slice-width",
  defaultWidth: 15,
  min: 5,
  max: 60,
});

interface PaceCardProps {
  /** Strava id of the running activity to analyse. */
  stravaId: number;
}

/**
 * Pace analysis for a single running activity, mirroring the cycling Power card:
 * a 30-second rolling-pace time-series, a time-in-zones breakdown, and a
 * pace-distribution histogram. All three read the activity's `velocity_smooth`
 * stream and the run threshold pace in effect on the activity's date.
 */
const PaceCard = React.memo(function PaceCard({ stravaId }: PaceCardProps) {
  const t = useT();
  const [tab, setTab] = React.useState<PaceTab>("timeline");
  const [sliceWidth] = paceSliceWidth.useSliceWidth();
  const { resolveForDate } = useRiderSettingsTimeline();

  const { data: activity } = trpc.activities.get.useQuery({ stravaId });

  // All three tabs work off the per-second speed.
  const { recording } = useActivityRecording(stravaId);
  const speeds = React.useMemo(
    () => recording?.perSecond.velocity_smooth ?? [],
    [recording],
  );

  const thresholdSpeed = activity
    ? resolveForDate(activitySettingsDay(activity)).runThresholdPace
    : 0;
  const averageSpeed = activity?.averageSpeed ?? null;

  const hint = (
    <FeatureHint
      hintId="hint-activity-pace"
      title={t("charts.pace.activityCardTitle")}
      side="right"
    >
      {t("charts.pace.hint")}
    </FeatureHint>
  );

  const tabOptions = [
    iconTabOption<PaceTab>(
      "timeline",
      ActivityIcon,
      t("charts.pace.tab30sPace"),
    ),
    iconTabOption<PaceTab>("zones", LayersIcon, t("charts.pace.tabZones")),
    iconTabOption<PaceTab>(
      "distribution",
      BarChart3Icon,
      t("charts.pace.tabDistribution"),
    ),
  ];

  const actions = (
    <>
      {hint}
      <div className="flex-1" />
      {/* Only the Distribution tab exposes a parameter (the slice width). */}
      {tab === "distribution" && (
        <ChartSettingsPopover label={t("charts.pace.settings")}>
          <SliceWidthSettings
            store={paceSliceWidth}
            title={t("charts.pace.distributionSettings")}
            label={t("charts.pace.sliceWidth")}
            hint={t("charts.pace.sliceWidthHint")}
          />
        </ChartSettingsPopover>
      )}
      <SegmentedToggle value={tab} onChange={setTab} options={tabOptions} />
    </>
  );

  return (
    <ChartCard title={t("charts.pace.activityCardTitle")} actions={actions}>
      {tab === "timeline" &&
        (recording == null ? (
          <StreamLoading />
        ) : (
          <PaceOverTime speeds={speeds} thresholdSpeed={thresholdSpeed} />
        ))}

      {tab === "zones" &&
        (recording == null ? (
          <StreamLoading />
        ) : (
          <PaceZoneDistribution
            speeds={speeds}
            thresholdSpeed={thresholdSpeed}
          />
        ))}

      {tab === "distribution" &&
        (recording == null ? (
          <StreamLoading />
        ) : (
          <PaceSliceDistribution
            speeds={speeds}
            thresholdSpeed={thresholdSpeed}
            sliceWidth={paceSliceWidth.clampSliceWidth(sliceWidth)}
            averageSpeed={averageSpeed}
          />
        ))}
    </ChartCard>
  );
});

export default PaceCard;

/** Loading placeholder shown while the activity's streams are still fetching. */
function StreamLoading() {
  const t = useT();
  return <ChartMessage>{t("charts.pace.loading")}</ChartMessage>;
}
