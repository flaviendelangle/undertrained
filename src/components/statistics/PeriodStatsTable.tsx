import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { useAthleteId } from "~/hooks/useAthleteId";
import { formatActivityType, formatHumanDuration } from "~/utils/format";
import { trpc } from "~/utils/trpc";

export function PeriodStatsTable() {
  const athleteId = useAthleteId();
  const { data: stats } = trpc.timePeriods.getStats.useQuery(
    { athleteId: athleteId! },
    { enabled: !!athleteId },
  );

  if (!stats || stats.length === 0) {
    return (
      <div className="border-border bg-card rounded-sm border max-sm:border-0 p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No time periods defined.{" "}
          <Link href="/settings/periods" className="text-primary underline">
            Create one in Settings
          </Link>{" "}
          to see aggregated statistics.
        </p>
      </div>
    );
  }

  return (
    <div className="border-border bg-card rounded-sm border max-sm:border-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Date Range</TableHead>
            <TableHead>Sports</TableHead>
            <TableHead className="text-right">Activities</TableHead>
            <TableHead className="text-right">Moving Time</TableHead>
            <TableHead className="text-right">Distance (km)</TableHead>
            <TableHead className="text-right">Elevation (m)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map((row) => (
            <TableRow key={row.period.id}>
              <TableCell className="font-medium">{row.period.name}</TableCell>
              <TableCell className="text-muted-foreground">
                {row.period.startDate} &mdash; {row.period.endDate}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {row.period.sportTypes
                  ? row.period.sportTypes.map(formatActivityType).join(", ")
                  : "All"}
              </TableCell>
              <TableCell className="text-right">
                {row.activityCount}
              </TableCell>
              <TableCell className="text-right">
                {formatHumanDuration(row.totalMovingTime)}
              </TableCell>
              <TableCell className="text-right">
                {(row.totalDistance / 1000).toFixed(1)}
              </TableCell>
              <TableCell className="text-right">
                {Math.round(row.totalElevation)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
