import * as React from "react";

import { format } from "date-fns";
import { HeartPulseIcon } from "lucide-react";
import nextDynamic from "next/dynamic";
import { useRouter } from "next/router";

import { FitnessDayEntries } from "~/components/fitness/FitnessDayEntries";
import { coveredDayKeys } from "~/components/journal/weekGrid";
import { PageToolbar } from "~/components/layouts/PageToolbar";
import { LoadingOverlay } from "~/components/primitives/LoadingOverlay";
import { QueryState } from "~/components/primitives/QueryState";
import { Button } from "~/components/ui/button";
import { ChartCardSurfaceProvider } from "~/components/ui/chart-card";
import { usePlannedTrainingList } from "~/hooks/plannedTrainings";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useFitnessData } from "~/hooks/useFitnessData";
import { useInitialLoadComplete } from "~/hooks/useInitialLoadComplete";
import { useModuleLoaded } from "~/hooks/useModuleLoaded";
import { formZoneLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { classifyForm } from "~/lib/fitness";
import type { NextPageWithLayout } from "~/pages/_app";
import { isCalendarDate } from "~/utils/activityFilters";

const loadFitnessChart = () =>
  import("~/components/charts/FitnessChart/FitnessChart").then(
    (module) => module.default,
  );
const FitnessChart = nextDynamic(loadFitnessChart, { ssr: false });
const inputClass =
  "border-input bg-background h-9 min-w-0 rounded-md border px-2 text-sm";

const FitnessPage: NextPageWithLayout = () => {
  const t = useT();
  const { series, isLoading, isError } = useFitnessData();
  const activitiesQuery = useActivitiesQuery("fitness");
  const plansQuery = usePlannedTrainingList();
  const modulesReady = useModuleLoaded(loadFitnessChart);
  const ready = useInitialLoadComplete(
    modulesReady && !isLoading && !plansQuery.isLoading,
    null,
    ["activities.list", "riderSettings.get", "plannedTrainings.list"],
  );
  const today = format(new Date(), "yyyy-MM-dd");
  const router = useRouter();
  const selectedDate =
    typeof router.query.day === "string" && isCalendarDate(router.query.day)
      ? router.query.day
      : today;
  const setSelectedDate = (day: string) => {
    if (isCalendarDate(day))
      void router.replace(
        { pathname: router.pathname, query: { ...router.query, day } },
        undefined,
        { shallow: true, scroll: false },
      );
  };
  const first = series[0] ? format(series[0].date, "yyyy-MM-dd") : today;
  const point = React.useMemo(
    () => series.find((p) => format(p.date, "yyyy-MM-dd") === selectedDate),
    [series, selectedDate],
  );
  const zone = point && classifyForm(point.tsb);
  const activities = React.useMemo(
    () =>
      activitiesQuery.data?.filter((activity) =>
        coveredDayKeys(activity.startDateLocal, activity.elapsedTime).includes(
          selectedDate,
        ),
      ) ?? [],
    [activitiesQuery.data, selectedDate],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className={`flex min-h-0 flex-1 flex-col ${ready ? "" : "invisible"}`}
        aria-hidden={!ready}
      >
        <PageToolbar title={t("fitnessPage.title")} icon={HeartPulseIcon} />
        <main className="flex-1 overflow-y-auto md:p-4">
          {isError ? (
            <QueryState error onRetry={() => void activitiesQuery.refetch()} />
          ) : isLoading ? (
            <QueryState loading />
          ) : !series.length ? (
            <QueryState>
              {t(
                activitiesQuery.data?.length
                  ? "charts.fitness.empty"
                  : "common.noActivities",
              )}
            </QueryState>
          ) : (
            <div className="divide-border border-border mx-auto flex max-w-[1500px] flex-col divide-y border-b md:gap-4 md:divide-y-0 md:border-0">
              <section className="md:bg-card overflow-hidden md:rounded-sm">
                <div className="flex flex-col gap-3 p-4">
                  <p className="text-muted-foreground text-sm">
                    {t("fitnessPage.source")}
                  </p>
                </div>
                <ChartCardSurfaceProvider surface="responsive">
                  <FitnessChart
                    series={series}
                    selectedPoint={point}
                    onDateChange={setSelectedDate}
                  />
                </ChartCardSurfaceProvider>
              </section>
              <section className="md:bg-card flex flex-col gap-4 p-4 md:rounded-sm">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {t("fitnessPage.selectedDay")}
                    <input
                      aria-label={t("fitnessPage.selectedDay")}
                      className={inputClass}
                      type="date"
                      value={selectedDate}
                      min={first}
                      onChange={(event) => setSelectedDate(event.target.value)}
                    />
                  </label>
                  <Button
                    variant="outline"
                    onClick={() => setSelectedDate(today)}
                  >
                    {t("fitnessPage.today")}
                  </Button>
                </div>
                {point && (
                  <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                    {[
                      [t("charts.fitness.series.fitness"), point.ctl],
                      [t("charts.fitness.series.fatigue"), point.atl],
                      [t("charts.fitness.series.form"), point.tsb],
                      [t("fitnessPage.load"), point.load],
                      [t("fitnessPage.ramp"), point.ramp],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-md border p-4">
                        <dt className="text-muted-foreground text-xs">
                          {label}
                        </dt>
                        <dd className="mt-1 text-2xl font-semibold tabular-nums">
                          {Number(value).toFixed(1)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {zone && (
                  <p className="text-sm" style={{ color: zone.color }}>
                    {formZoneLabel(zone.key, t)}
                  </p>
                )}
                <FitnessDayEntries
                  activities={activities}
                  selectedDate={selectedDate}
                />
              </section>
            </div>
          )}
        </main>
      </div>
      <LoadingOverlay hidden={ready} />
    </div>
  );
};
export default FitnessPage;
