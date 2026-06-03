import * as React from "react";

import { BarChartPremium } from "@mui/x-charts-premium";

import { ChartCard } from "~/components/ui/chart-card";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { useActivitiesFilteredByType } from "~/hooks/useActivitiesFilteredByType";
import { useEddingtonData } from "~/hooks/useEddingtonData";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useT } from "~/i18n/useT";
import {
  AXIS_SIZE,
  CHART_MARGINS,
  formatCompact,
  useChartTokens,
} from "~/lib/chartTokens";
import { getSportConfig } from "~/utils/sportConfig";

import { ChartMessage } from "../ChartMessage";
import { ChartThemeProvider } from "../ChartThemeProvider";
import { ChartTooltip } from "../ChartTooltip";

const TABS = {
  riding: { label: "Riding", activityTypes: ["Ride", "VirtualRide"] },
  running: { label: "Running", activityTypes: ["Run"] },
} as const;

type TabKey = keyof typeof TABS;

const RideIcon = getSportConfig("Ride").icon;
const RunIcon = getSportConfig("Run").icon;

const TAB_OPTIONS: { value: TabKey; label: React.ReactNode }[] = [
  { value: "riding", label: <RideIcon className="size-3.5" /> },
  { value: "running", label: <RunIcon className="size-3.5" /> },
];

const DISTANCE_DIVISOR = 1000;

export default function EddingtonChart() {
  const t = useT();
  const [activeTab, setActiveTab] = React.useState<TabKey>("riding");
  const tokens = useChartTokens();
  const isMobile = useIsMobile();
  const tab = TABS[activeTab];

  // Share the full unfiltered activities query with the other statistics charts
  // and filter to this tab's sports client-side (useEddingtonData is a pure
  // client transform), instead of fetching a separate per-tab list.
  const { activities } = useActivitiesFilteredByType(tab.activityTypes);

  const eddington = useEddingtonData(activities, DISTANCE_DIVISOR);

  // Derive the chart arrays once per data/palette change. Without this they'd be
  // rebuilt — and handed as fresh references to BarChartPremium — on every
  // render (e.g. toggling the riding/running tab, or any parent re-render).
  const chartData = React.useMemo(() => {
    if (!eddington || eddington.data.length === 0) return null;
    const trimmedData = trimData(eddington.data, eddington.eddingtonNumber);
    const totalBars = trimmedData.length;
    const eddingtonIndex = trimmedData.findIndex(
      (d) => d.n === eddington.eddingtonNumber,
    );
    const zoomStart = Math.max(0, eddingtonIndex - 10);
    const zoomEnd = Math.min(totalBars, eddingtonIndex + 11);
    return {
      xAxisData: trimmedData.map((d) => d.n),
      yAxisData: trimmedData.map((d) => d.daysAbove),
      barColors: trimmedData.map((d) =>
        // Brand teal marks the Eddington-number bar (highlight/selection accent);
        // the rest stay on the neutral series blue.
        d.n === eddington.eddingtonNumber ? tokens.accent : tokens.palette[3],
      ),
      initialZoom:
        totalBars > 0
          ? [
              {
                axisId: "distance" as const,
                start: (zoomStart / totalBars) * 100,
                end: (zoomEnd / totalBars) * 100,
              },
            ]
          : undefined,
    };
  }, [eddington, tokens]);

  const actions = (
    <>
      {eddington && eddington.eddingtonNumber > 0 && (
        <span className="bg-primary/15 text-primary rounded px-2 py-0.5 text-xs font-semibold">
          E = {eddington.eddingtonNumber}
        </span>
      )}
      <div className="ml-auto">
        <SegmentedToggle
          value={activeTab}
          onChange={setActiveTab}
          options={TAB_OPTIONS}
        />
      </div>
    </>
  );

  if (!chartData) {
    return (
      <ChartThemeProvider>
        <ChartCard
          title={t("charts.eddington.title")}
          info={t("charts.eddington.info")}
          actions={actions}
        >
          <ChartMessage>{t("charts.eddington.empty")}</ChartMessage>
        </ChartCard>
      </ChartThemeProvider>
    );
  }

  const { xAxisData, yAxisData, barColors, initialZoom } = chartData;

  return (
    <ChartThemeProvider>
      <ChartCard
        title={t("charts.eddington.title")}
        info={t("charts.eddington.info")}
        actions={actions}
      >
        <BarChartPremium
          key={activeTab}
          renderer="webgl"
          initialZoom={initialZoom}
          xAxis={[
            {
              id: "distance",
              scaleType: "band",
              data: xAxisData,
              label: isMobile ? undefined : t("charts.eddington.distanceAxis"),
              height: isMobile
                ? AXIS_SIZE.mobile.height
                : AXIS_SIZE.desktop.height,
              valueFormatter: (value: number) => `${value}`,
              zoom: { filterMode: "discard" },
              colorMap: {
                type: "ordinal",
                values: xAxisData,
                colors: barColors,
              },
            },
          ]}
          yAxis={[
            {
              label: isMobile ? undefined : t("charts.eddington.daysAxis"),
              valueFormatter: (value: number) =>
                isMobile
                  ? formatCompact(value)
                  : Math.round(value).toLocaleString(),
              width: isMobile
                ? AXIS_SIZE.mobile.width
                : AXIS_SIZE.desktop.width,
            },
          ]}
          series={[
            {
              data: yAxisData,
              label: t("charts.eddington.daysAxis"),
            },
          ]}
          grid={{ horizontal: true }}
          skipAnimation
          margin={
            isMobile ? CHART_MARGINS.standardMobile : CHART_MARGINS.standard
          }
          hideLegend
          slots={{ tooltip: ChartTooltip }}
        />
      </ChartCard>
    </ChartThemeProvider>
  );
}

/**
 * Trim data to show a meaningful range around the Eddington number.
 */
function trimData(
  data: { n: number; daysAbove: number }[],
  eddingtonNumber: number,
) {
  // Find the last index with daysAbove > 0
  let lastNonZero = 0;
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].daysAbove > 0) {
      lastNonZero = i;
      break;
    }
  }

  const upperBound = Math.max(
    Math.ceil(eddingtonNumber * 1.2),
    lastNonZero + 1,
  );

  return data.slice(0, Math.min(upperBound, data.length));
}
