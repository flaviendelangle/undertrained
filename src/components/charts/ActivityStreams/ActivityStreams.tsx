import * as React from "react";

import { useValueAsRef } from "@base-ui/utils/useValueAsRef";

import { FeatureHint } from "~/components/primitives/FeatureHint";
import { ChartCard } from "~/components/ui/chart-card";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { useAthleteId } from "~/hooks/useAthleteId";
import { type TFunction } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { getSportConfig } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

import { ChartMessage } from "../ChartMessage";
import { MultiPanelChart } from "./MultiPanelChart";
import type { PreparedStream, StreamStats, XAxisMode } from "./types";

const createXAxisOptions = (
  t: TFunction,
): { value: XAxisMode; label: string }[] => [
  { value: "time", label: t("charts.streams.xAxis.time") },
  { value: "distance", label: t("charts.streams.xAxis.distance") },
];

interface StreamDef {
  type: string;
  title: string;
  unit: string;
  /** Index into the chart token palette */
  colorIndex: number;
  area: boolean;
}

const createStreamDefs = (t: TFunction): StreamDef[] => [
  {
    type: "heartrate",
    title: t("charts.streams.stream.heartRate"),
    unit: "bpm",
    colorIndex: 0,
    area: false,
  },
  {
    type: "watts",
    title: t("charts.streams.stream.power"),
    unit: "W",
    colorIndex: 1,
    area: false,
  },
  {
    type: "cadence",
    title: t("charts.streams.stream.cadence"),
    unit: "rpm",
    colorIndex: 2,
    area: false,
  },
  {
    type: "velocity_smooth",
    title: t("charts.streams.stream.speed"),
    unit: "m/s",
    colorIndex: 3,
    area: false,
  },
  {
    type: "altitude",
    title: t("charts.streams.stream.altitude"),
    unit: "m",
    colorIndex: 4,
    area: true,
  },
  {
    type: "temp",
    title: t("charts.streams.stream.temperature"),
    unit: "°C",
    colorIndex: 5,
    area: false,
  },
];

function parseStreamData(data: string): number[] | null {
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function ActivityStreams(props: ActivityStreamsProps) {
  const { stravaId, onHoverPositionChange, hiddenStreams } = props;
  const t = useT();
  const streamDefs = React.useMemo(() => createStreamDefs(t), [t]);
  const athleteId = useAthleteId();
  const tokens = useChartTokens();

  const { data: activity } = trpc.activities.get.useQuery({ stravaId });
  const { data: streamsData } = trpc.activityStreams.getStreams.useQuery({
    stravaId,
  });
  const fetchStreams = trpc.activityStreams.fetchStreams.useMutation();
  const fetchStreamsRef = useValueAsRef(fetchStreams);
  const [isFetching, setIsFetching] = React.useState(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const hasFetched = React.useRef(false);
  const [xAxisMode, setXAxisMode] = React.useState<XAxisMode>("time");

  React.useEffect(() => {
    if (streamsData === null && athleteId && !hasFetched.current) {
      hasFetched.current = true;
      setIsFetching(true);
      setFetchError(null);
      fetchStreamsRef.current
        .mutateAsync({ stravaId, athleteId })
        .catch((err: unknown) => setFetchError(String(err)))
        .finally(() => setIsFetching(false));
    }
  }, [streamsData, athleteId, stravaId, fetchStreamsRef]);

  const latlngData = React.useMemo(() => {
    if (!streamsData) return null;
    const latlngStream = streamsData.find((s) => s.type === "latlng");
    if (!latlngStream) return null;
    try {
      return JSON.parse(latlngStream.data) as [number, number][];
    } catch {
      return null;
    }
  }, [streamsData]);

  const handleHoverIndexChange = React.useCallback(
    (index: number | null) => {
      if (!onHoverPositionChange) return;
      if (index === null || !latlngData) {
        onHoverPositionChange(null);
      } else {
        onHoverPositionChange(latlngData[index] ?? null);
      }
    },
    [latlngData, onHoverPositionChange],
  );

  // Parse stream JSON once — only re-runs when raw stream data changes
  const parsedStreams = React.useMemo(() => {
    if (!streamsData) return null;

    const streamsByType = new Map(streamsData.map((s) => [s.type, s]));

    const distanceStream = streamsByType.get("distance");
    const distanceData = distanceStream
      ? parseStreamData(distanceStream.data)
      : null;

    const defs = hiddenStreams
      ? streamDefs.filter((d) => !hiddenStreams.includes(d.type))
      : streamDefs;

    const parsed = defs
      .map((def) => {
        const stream = streamsByType.get(def.type);
        if (!stream) return null;

        const yData = parseStreamData(stream.data);
        if (!yData) return null;

        let yMin = Infinity;
        let yMax = -Infinity;
        let sum = 0;
        for (const v of yData) {
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
          sum += v;
        }
        if (!Number.isFinite(yMin)) yMin = 0;
        if (!Number.isFinite(yMax)) yMax = 1;
        const avg = yData.length > 0 ? sum / yData.length : 0;
        const range = yMax - yMin;
        const padding = range > 0 ? range * 0.05 : 1;

        return {
          def,
          yData,
          yMin: yMin - padding,
          yMax: yMax + padding,
          stats: { min: yMin, max: yMax, avg },
        };
      })
      .filter(
        (
          s,
        ): s is {
          def: StreamDef;
          yData: number[];
          yMin: number;
          yMax: number;
          stats: StreamStats;
        } => s !== null,
      );

    return { parsed, distanceData };
  }, [streamsData, hiddenStreams, streamDefs]);

  const sportConfig = activity ? getSportConfig(activity.type) : null;

  // Assemble final streams with color tokens — cheap, re-runs on theme change
  const { streams, distanceData } = React.useMemo(() => {
    if (!activity || !parsedStreams || tokens.paletteOklch.length === 0) {
      return { streams: [], distanceData: null };
    }

    const preparedStreams: PreparedStream[] = parsedStreams.parsed.map(
      ({ def, yData, yMin, yMax, stats }) => ({
        config: {
          type: def.type,
          title:
            def.type === "velocity_smooth" && sportConfig
              ? t(sportConfig.speedLabelKey)
              : def.title,
          unit:
            def.type === "cadence" && sportConfig
              ? sportConfig.cadenceUnit
              : def.unit,
          color: tokens.palette[def.colorIndex] ?? tokens.palette[0],
          area: def.area,
        },
        yData,
        yMin,
        yMax,
        stats,
      }),
    );

    return {
      streams: preparedStreams,
      distanceData: parsedStreams.distanceData,
    };
  }, [
    parsedStreams,
    activity,
    sportConfig,
    tokens.palette,
    tokens.paletteOklch.length,
    t,
  ]);
  const distanceAvailable = distanceData != null;

  const allXAxisOptions = React.useMemo(() => createXAxisOptions(t), [t]);
  const xAxisOptions = distanceAvailable
    ? allXAxisOptions
    : allXAxisOptions.filter((opt) => opt.value !== "distance");

  // Build x-axis data (time indices)
  const xData = React.useMemo(() => {
    if (streams.length === 0) return [];
    return streams[0].yData.map((_, i) => i);
  }, [streams]);

  if (fetchError) {
    return (
      <ChartCard title={t("charts.streams.title")}>
        <ChartMessage tone="error">
          {t("charts.streams.loadError", { error: fetchError })}
        </ChartMessage>
      </ChartCard>
    );
  }

  if (isFetching || streamsData === undefined || streamsData === null) {
    return (
      <ChartCard title={t("charts.streams.title")}>
        <ChartMessage>{t("charts.streams.loading")}</ChartMessage>
      </ChartCard>
    );
  }

  if (streams.length === 0) {
    return (
      <ChartCard title={t("charts.streams.title")}>
        <ChartMessage>{t("charts.streams.empty")}</ChartMessage>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title={t("charts.streams.title")}
      headerSlot={
        <FeatureHint
          hintId="hint-activity-streams"
          title={t("charts.streams.title")}
        >
          {t("charts.streams.hint")}
        </FeatureHint>
      }
      actions={
        xAxisOptions.length > 1 ? (
          <div className="ml-auto">
            <SegmentedToggle
              value={xAxisMode}
              onChange={setXAxisMode}
              options={xAxisOptions}
            />
          </div>
        ) : undefined
      }
      height="auto"
    >
      <MultiPanelChart
        streams={streams}
        xData={xData}
        distanceData={distanceData}
        xAxisMode={xAxisMode}
        sportConfig={sportConfig}
        onHoverIndexChange={handleHoverIndexChange}
      />
    </ChartCard>
  );
}

interface ActivityStreamsProps {
  stravaId: number;
  onHoverPositionChange?: (position: [number, number] | null) => void;
  hiddenStreams?: string[];
}
