import { useValueAsRef } from "@base-ui/utils/useValueAsRef";
import * as React from "react";

import { FeatureHint } from "~/components/primitives/FeatureHint";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useChartTokens } from "~/lib/chartTokens";
import { getSportConfig } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

import { MultiPanelChart } from "./MultiPanelChart";
import type { PreparedStream, StreamStats, XAxisMode } from "./types";

const X_AXIS_OPTIONS: { value: XAxisMode; label: string }[] = [
  { value: "time", label: "Time" },
  { value: "distance", label: "Distance" },
];

interface StreamDef {
  type: string;
  title: string;
  unit: string;
  /** Index into the chart token palette */
  colorIndex: number;
  area: boolean;
}

const STREAM_DEFS: StreamDef[] = [
  {
    type: "heartrate",
    title: "Heart rate",
    unit: "bpm",
    colorIndex: 0,
    area: false,
  },
  { type: "watts", title: "Power", unit: "W", colorIndex: 1, area: false },
  {
    type: "cadence",
    title: "Cadence",
    unit: "rpm",
    colorIndex: 2,
    area: false,
  },
  {
    type: "velocity_smooth",
    title: "Speed",
    unit: "m/s",
    colorIndex: 3,
    area: false,
  },
  { type: "altitude", title: "Altitude", unit: "m", colorIndex: 4, area: true },
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
      ? STREAM_DEFS.filter((d) => !hiddenStreams.includes(d.type))
      : STREAM_DEFS;

    const parsed = defs.map((def) => {
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
    }).filter(
      (s): s is {
        def: StreamDef;
        yData: number[];
        yMin: number;
        yMax: number;
        stats: StreamStats;
      } => s !== null,
    );

    return { parsed, distanceData };
  }, [streamsData, hiddenStreams]);

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
              ? sportConfig.speedLabel
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

    return { streams: preparedStreams, distanceData: parsedStreams.distanceData };
  }, [parsedStreams, activity, sportConfig, tokens.palette, tokens.paletteOklch.length]);
  const distanceAvailable = distanceData != null;

  const xAxisOptions = distanceAvailable
    ? X_AXIS_OPTIONS
    : X_AXIS_OPTIONS.filter((opt) => opt.value !== "distance");

  // Build x-axis data (time indices)
  const xData = React.useMemo(() => {
    if (streams.length === 0) return [];
    return streams[0].yData.map((_, i) => i);
  }, [streams]);

  if (fetchError) {
    return (
      <div className="bg-card rounded-sm p-4 text-red-400">
        Failed to load streams: {fetchError}
      </div>
    );
  }

  if (isFetching || streamsData === undefined || streamsData === null) {
    return (
      <div className="bg-card text-muted-foreground rounded-sm p-4">
        Loading stream data...
      </div>
    );
  }

  if (streams.length === 0) {
    return (
      <div className="bg-card text-muted-foreground rounded-sm p-4">
        No stream data available for this activity.
      </div>
    );
  }

  return (
    <div className="bg-card flex flex-col rounded-sm">
      <div className="border-border flex items-center gap-2 border-b p-4">
        <h3 className="text-lg font-semibold">Time Series</h3>
        <FeatureHint hintId="hint-activity-streams" title="Time Series">
          Heart rate, power, cadence, speed, and altitude plotted over time or
          distance. Hover to see all metrics at a specific point. Toggle the
          X-axis between time and distance.
        </FeatureHint>
        <div className="flex-1" />
        {xAxisOptions.length > 1 && (
          <SegmentedToggle
            value={xAxisMode}
            onChange={setXAxisMode}
            options={xAxisOptions}
          />
        )}
      </div>
      <MultiPanelChart
        streams={streams}
        xData={xData}
        distanceData={distanceData}
        xAxisMode={xAxisMode}
        sportConfig={sportConfig}
        onHoverIndexChange={handleHoverIndexChange}
      />
    </div>
  );
}

interface ActivityStreamsProps {
  stravaId: number;
  onHoverPositionChange?: (position: [number, number] | null) => void;
  hiddenStreams?: string[];
}
