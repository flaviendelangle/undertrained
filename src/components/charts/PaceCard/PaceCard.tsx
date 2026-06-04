import * as React from "react";

import {
  ActivityIcon,
  BarChart3Icon,
  LayersIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

import { FeatureHint } from "~/components/primitives/FeatureHint";
import { Button } from "~/components/ui/button";
import { ChartCard } from "~/components/ui/chart-card";
import { Label } from "~/components/ui/label";
import { NumberField } from "~/components/ui/number-field";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverHeader,
  ResponsivePopoverTitle,
  ResponsivePopoverTrigger,
} from "~/components/ui/responsive-popover";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
import { trpc } from "~/utils/trpc";

import { ChartMessage } from "../ChartMessage";
import { PaceOverTime } from "./PaceOverTime";
import { PaceSliceDistribution } from "./PaceSliceDistribution";
import { PaceZoneDistribution } from "./PaceZoneDistribution";
import {
  MAX_SLICE_WIDTH,
  MIN_SLICE_WIDTH,
  clampSliceWidth,
  usePaceSliceWidth,
} from "./usePaceSliceWidth";

type PaceTab = "timeline" | "zones" | "distribution";

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
  const [sliceWidth, setSliceWidth] = usePaceSliceWidth();
  const { resolveForDate } = useRiderSettingsTimeline();

  const { data: activity } = trpc.activities.get.useQuery({ stravaId });

  // All three tabs work off the raw per-second speed stream. `ActivityStreams`
  // higher on the page is responsible for fetching streams, so we only read the
  // cached query here.
  const { data: streamsData } = trpc.activityStreams.getStreams.useQuery({
    stravaId,
  });

  const speeds = React.useMemo<number[]>(() => {
    const stream = streamsData?.find((s) => s.type === "velocity_smooth");
    if (!stream) return [];
    try {
      const parsed: unknown = JSON.parse(stream.data);
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch {
      return [];
    }
  }, [streamsData]);

  const thresholdSpeed = activity?.startDate
    ? resolveForDate(activity.startDate).runThresholdPace
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

  const tabOptions: {
    value: PaceTab;
    label: React.ReactNode;
    tooltip: string;
  }[] = [
    {
      value: "timeline",
      tooltip: t("charts.pace.tab30sPace"),
      label: (
        <>
          <ActivityIcon className="size-4" />
          <span className="sr-only">{t("charts.pace.tab30sPace")}</span>
        </>
      ),
    },
    {
      value: "zones",
      tooltip: t("charts.pace.tabZones"),
      label: (
        <>
          <LayersIcon className="size-4" />
          <span className="sr-only">{t("charts.pace.tabZones")}</span>
        </>
      ),
    },
    {
      value: "distribution",
      tooltip: t("charts.pace.tabDistribution"),
      label: (
        <>
          <BarChart3Icon className="size-4" />
          <span className="sr-only">{t("charts.pace.tabDistribution")}</span>
        </>
      ),
    },
  ];

  // Only the Distribution tab exposes a parameter (the histogram slice width).
  const settings =
    tab === "distribution" ? (
      <DistributionSettings
        sliceWidth={sliceWidth}
        onSliceWidthChange={setSliceWidth}
      />
    ) : null;

  const actions = (
    <>
      {hint}
      <div className="flex-1" />
      {settings && (
        <ResponsivePopover>
          <ResponsivePopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground size-6"
                aria-label={t("charts.pace.settings")}
              >
                <SlidersHorizontalIcon className="size-4" />
              </Button>
            }
          />
          <ResponsivePopoverContent
            align="end"
            className="flex flex-col gap-4 sm:w-72"
          >
            {settings}
          </ResponsivePopoverContent>
        </ResponsivePopover>
      )}
      <SegmentedToggle value={tab} onChange={setTab} options={tabOptions} />
    </>
  );

  return (
    <ChartCard title={t("charts.pace.activityCardTitle")} actions={actions}>
      {tab === "timeline" &&
        (streamsData == null ? (
          <StreamLoading />
        ) : (
          <PaceOverTime speeds={speeds} thresholdSpeed={thresholdSpeed} />
        ))}

      {tab === "zones" &&
        (streamsData == null ? (
          <StreamLoading />
        ) : (
          <PaceZoneDistribution
            speeds={speeds}
            thresholdSpeed={thresholdSpeed}
          />
        ))}

      {tab === "distribution" &&
        (streamsData == null ? (
          <StreamLoading />
        ) : (
          <PaceSliceDistribution
            speeds={speeds}
            thresholdSpeed={thresholdSpeed}
            sliceWidth={clampSliceWidth(sliceWidth)}
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

/** Distribution-tab parameter: the histogram slice width (seconds per km). */
function DistributionSettings({
  sliceWidth,
  onSliceWidthChange,
}: {
  sliceWidth: number;
  onSliceWidthChange: (width: number) => void;
}) {
  const t = useT();
  return (
    <>
      <ResponsivePopoverHeader>
        <ResponsivePopoverTitle>
          {t("charts.pace.distributionSettings")}
        </ResponsivePopoverTitle>
      </ResponsivePopoverHeader>
      <div className="flex flex-col gap-1.5">
        <Label>{t("charts.pace.sliceWidth")}</Label>
        <NumberField
          className="w-full"
          value={sliceWidth}
          onValueChange={(value) => {
            if (value != null) onSliceWidthChange(value);
          }}
          min={MIN_SLICE_WIDTH}
          max={MAX_SLICE_WIDTH}
          step={5}
          smallStep={1}
        />
        <p className="text-muted-foreground text-xs">
          {t("charts.pace.sliceWidthHint")}
        </p>
      </div>
    </>
  );
}
