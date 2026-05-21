import { FitWriter } from "@markw65/fit-file-writer";

import type { SessionDataPoint, SessionSummary } from "~/sensors/types";

export function generateFitFile(
  dataPoints: SessionDataPoint[],
  summary: SessionSummary,
): ArrayBuffer {
  const writer = new FitWriter();

  const startTime = summary.startTime;

  // File ID
  writer.writeMessage("file_id", {
    type: "activity",
    manufacturer: "development",
    product: 0,
    serial_number: 0,
    time_created: writer.time(startTime),
  });

  // Event: timer start
  writer.writeMessage("event", {
    timestamp: writer.time(startTime),
    event: "timer",
    event_type: "start",
  });

  // Record messages (one per second)
  for (const point of dataPoints) {
    const recordTime = new Date(point.timestamp);
    const record = {
      timestamp: writer.time(recordTime),
      distance: point.distance,
      ...(point.heartRate != null && { heart_rate: point.heartRate }),
      ...(point.power != null && { power: point.power }),
      ...(point.cadence != null && { cadence: Math.round(point.cadence) }),
      ...(point.speed != null && { speed: point.speed }),
    };

    writer.writeMessage("record", record);
  }

  // Event: timer stop
  const endTime = new Date(
    dataPoints[dataPoints.length - 1]?.timestamp ?? startTime.getTime(),
  );
  writer.writeMessage("event", {
    timestamp: writer.time(endTime),
    event: "timer",
    event_type: "stop_all",
  });

  // Lap message
  const lapRecord = {
    timestamp: writer.time(endTime),
    start_time: writer.time(startTime),
    total_elapsed_time: summary.elapsedSeconds,
    total_timer_time: summary.elapsedSeconds,
    total_distance: summary.totalDistance,
    message_index: { value: 0 },
    ...(summary.avgPower != null && { avg_power: summary.avgPower }),
    ...(summary.maxPower != null && { max_power: summary.maxPower }),
    ...(summary.avgHeartRate != null && {
      avg_heart_rate: summary.avgHeartRate,
    }),
    ...(summary.maxHeartRate != null && {
      max_heart_rate: summary.maxHeartRate,
    }),
    ...(summary.avgCadence != null && { avg_cadence: summary.avgCadence }),
    ...(summary.maxCadence != null && { max_cadence: summary.maxCadence }),
  };
  writer.writeMessage("lap", lapRecord);

  // Session message
  const sessionRecord = {
    timestamp: writer.time(endTime),
    start_time: writer.time(startTime),
    total_elapsed_time: summary.elapsedSeconds,
    total_timer_time: summary.elapsedSeconds,
    total_distance: summary.totalDistance,
    sport: "cycling" as const,
    sub_sport: "indoor_cycling" as const,
    message_index: { value: 0 },
    first_lap_index: 0,
    num_laps: 1,
    ...(summary.avgPower != null && { avg_power: summary.avgPower }),
    ...(summary.maxPower != null && { max_power: summary.maxPower }),
    ...(summary.normalizedPower != null && {
      normalized_power: summary.normalizedPower,
    }),
    ...(summary.avgHeartRate != null && {
      avg_heart_rate: summary.avgHeartRate,
    }),
    ...(summary.maxHeartRate != null && {
      max_heart_rate: summary.maxHeartRate,
    }),
    ...(summary.avgCadence != null && { avg_cadence: summary.avgCadence }),
    ...(summary.maxCadence != null && { max_cadence: summary.maxCadence }),
    ...(summary.avgSpeed != null && { avg_speed: summary.avgSpeed }),
    ...(summary.maxSpeed != null && { max_speed: summary.maxSpeed }),
  };
  writer.writeMessage("session", sessionRecord);

  // Activity message
  writer.writeMessage("activity", {
    timestamp: writer.time(endTime),
    total_timer_time: summary.elapsedSeconds,
    num_sessions: 1,
    type: "manual",
  });

  const dataView = writer.finish();
  return dataView.buffer.slice(
    dataView.byteOffset,
    dataView.byteOffset + dataView.byteLength,
  ) as ArrayBuffer;
}

export function downloadFitFile(buffer: ArrayBuffer, name?: string): void {
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    name ??
    `training_${new Date().toISOString().slice(0, 16).replace(":", "-")}.fit`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
