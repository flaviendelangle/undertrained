/** Power-curve axis/tooltip duration label: "30s", "5min", "1h05", "2m30s". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return mins === 0
      ? `${hours}h`
      : `${hours}h${mins.toString().padStart(2, "0")}`;
  }
  return secs === 0
    ? `${mins}min`
    : `${mins}m${secs.toString().padStart(2, "0")}s`;
}
