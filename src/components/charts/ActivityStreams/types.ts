import type { SportConfig } from "~/utils/sportConfig";

export type XAxisMode = "time" | "distance";

export interface StreamConfig {
  type: string;
  title: string;
  unit: string;
  color: string;
  area: boolean;
}

export interface StreamStats {
  /** Actual (unpadded) minimum of the data. */
  min: number;
  /** Actual (unpadded) maximum of the data. */
  max: number;
  /** Arithmetic mean of the data. */
  avg: number;
}

export interface PreparedStream {
  config: StreamConfig;
  yData: number[];
  yMin: number;
  yMax: number;
  stats: StreamStats;
}

export interface PanelLayout {
  /** y offset from top of the drawing area */
  top: number;
  /** height of this panel's drawing area */
  height: number;
  stream: PreparedStream;
}

export interface MultiPanelChartProps {
  streams: PreparedStream[];
  xData: number[];
  distanceData: number[] | null;
  xAxisMode: XAxisMode;
  sportConfig: SportConfig | null;
  onHoverIndexChange?: (index: number | null) => void;
}
