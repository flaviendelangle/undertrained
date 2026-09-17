import { CalendarIcon } from "lucide-react";

import { PeriodsDashboard } from "~/components/periods/PeriodsDashboard";
import { PeriodsEmptyState } from "~/components/periods/shared";
import { LoadingOverlay } from "~/components/primitives/LoadingOverlay";
import { QueryState } from "~/components/primitives/QueryState";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { showErrorToast } from "~/components/ui/toast";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useInitialLoadComplete } from "~/hooks/useInitialLoadComplete";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";
import { trpc } from "~/utils/trpc";

const PeriodsPage: NextPageWithLayout = () => {
  const t = useT();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();

  const {
    data: stats,
    isPending,
    isError,
    refetch,
  } = trpc.timePeriods.getStats.useQuery(
    { athleteId: athleteId! },
    { enabled: !!athleteId },
  );

  const deleteMutation = trpc.timePeriods.delete.useMutation({
    onSuccess: () => utils.timePeriods.invalidate(),
    onError: () => showErrorToast(t("common.deleteError")),
  });

  const onDelete = async (id: number) => {
    if (!athleteId) return;
    await deleteMutation.mutateAsync({ athleteId, id });
  };

  const hasPeriods = stats != null && stats.length > 0;
  const ready = useInitialLoadComplete(!isPending, 10000, [
    "timePeriods.getStats",
  ]);

  return (
    <>
      <Toolbar label={t("periods.pageTitle")}>
        <CalendarIcon className="size-4" />
        <span className="font-semibold">{t("periods.pageTitle")}</span>
      </Toolbar>

      <div className="relative flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto p-3 max-sm:px-0 sm:p-4">
          {isError ? (
            <QueryState error onRetry={() => void refetch()} />
          ) : isPending ? (
            <QueryState loading />
          ) : hasPeriods ? (
            <PeriodsDashboard stats={stats} onDelete={onDelete} />
          ) : (
            <div className="w-full max-sm:px-3">
              <PeriodsEmptyState />
            </div>
          )}
        </div>
        <LoadingOverlay hidden={ready} />
      </div>
    </>
  );
};

export default PeriodsPage;
