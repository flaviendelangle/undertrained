import * as React from "react";

import { BarChartPro } from "@mui/x-charts-pro";

import { ChartCard } from "~/components/ui/chart-card";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useEddingtonData } from "~/hooks/useEddingtonData";
import { useIsMobile } from "~/hooks/useIsMobile";
import {
  AXIS_SIZE,
  CHART_MARGINS,
  formatCompact,
  useChartTokens,
} from "~/lib/chartTokens";
import { getSportConfig } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

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
const UNIT_LABEL = "Distance";
const INFO =
  "Your Eddington number E is the largest number such that you have cycled at least E km on E different days. Each bar shows how many days you rode at least that distance.";

export default function EddingtonChart() {
  const [activeTab, setActiveTab] = React.useState<TabKey>("riding");
  const tokens = useChartTokens();
  const isMobile = useIsMobile();
  const athleteId = useAthleteId();

  const tab = TABS[activeTab];

  const { data } = trpc.activities.list.useQuery(
    { athleteId: athleteId!, activityTypes: [...tab.activityTypes] },
    { enabled: athleteId != null },
  );

  const eddington = useEddingtonData(data?.activities, DISTANCE_DIVISOR);

  const actions = (
    <>
      {eddington && eddington.eddingtonNumber > 0 && (
        <span className="rounded bg-orange-500/20 px-2 py-0.5 text-xs font-semibold text-orange-400">
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

  if (!eddington || eddington.data.length === 0) {
    return (
      <ChartThemeProvider>
        <ChartCard title="Eddington Number" info={INFO} actions={actions}>
          <div className="text-muted-foreground flex h-full items-center justify-center">
            No data available
          </div>
        </ChartCard>
      </ChartThemeProvider>
    );
  }

  const trimmedData = trimData(eddington.data, eddington.eddingtonNumber);

  const xAxisData = trimmedData.map((d) => d.n);
  const yAxisData = trimmedData.map((d) => d.daysAbove);
  const barColors = trimmedData.map((d) =>
    d.n === eddington.eddingtonNumber ? tokens.palette[5] : tokens.palette[3],
  );

  const totalBars = trimmedData.length;
  const eddingtonIndex = trimmedData.findIndex(
    (d) => d.n === eddington.eddingtonNumber,
  );
  const zoomStart = Math.max(0, eddingtonIndex - 10);
  const zoomEnd = Math.min(totalBars, eddingtonIndex + 11);
  const initialZoom =
    totalBars > 0
      ? [
          {
            axisId: "distance" as const,
            start: (zoomStart / totalBars) * 100,
            end: (zoomEnd / totalBars) * 100,
          },
        ]
      : undefined;

  return (
    <ChartThemeProvider>
      <ChartCard title="Eddington Number" info={INFO} actions={actions}>
        <BarChartPro
          key={activeTab}
          initialZoom={initialZoom}
          xAxis={[
            {
              id: "distance",
              scaleType: "band",
              data: xAxisData,
              label: isMobile ? undefined : UNIT_LABEL,
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
              label: isMobile ? undefined : "Days",
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
              label: "Days",
            },
          ]}
          grid={{ horizontal: true }}
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
