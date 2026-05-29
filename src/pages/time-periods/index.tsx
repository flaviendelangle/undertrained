import { CalendarIcon } from "lucide-react";

import { PeriodsDashboard } from "~/components/periods/PeriodsDashboard";
import { PeriodsEmptyState } from "~/components/periods/shared";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";
import { trpc } from "~/utils/trpc";

const PeriodsPage: NextPageWithLayout = () => {
  const t = useT();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();

  const { data: stats } = trpc.timePeriods.getStats.useQuery(
    { athleteId: athleteId! },
    { enabled: !!athleteId },
  );

  const deleteMutation = trpc.timePeriods.delete.useMutation({
    onSuccess: () => utils.timePeriods.invalidate(),
  });

  const onDelete = (id: number) => {
    if (!athleteId) return;
    deleteMutation.mutate({ athleteId, id });
  };

  const hasPeriods = stats != null && stats.length > 0;

  return (
    <>
      <Toolbar label={t("periods.pageTitle")}>
        <CalendarIcon className="size-4" />
        <span className="font-semibold">{t("periods.pageTitle")}</span>
      </Toolbar>

      <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto p-3 max-sm:px-0 sm:p-4">
        {stats == null ? null : hasPeriods ? (
          <PeriodsDashboard stats={stats} onDelete={onDelete} />
        ) : (
          <div className="w-full max-sm:px-3">
            <PeriodsEmptyState />
          </div>
        )}
      </div>
    </>
  );
};

export default PeriodsPage;
