import * as React from "react";

import { SettingsIcon } from "lucide-react";
import { signOut } from "next-auth/react";

import { CardTitle } from "~/components/primitives/CardTitle";
import { LanguageSelect } from "~/components/settings/LanguageSelect";
import { RiderMetricCards } from "~/components/settings/rider/RiderMetricCards";
import { ResetHintsButton } from "~/components/settings/ResetHintsButton";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import {
  DangerZone,
  EquipmentFields,
  LoadAlgorithmFields,
} from "~/components/settings/layouts/shared";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";
import { trpc } from "~/utils/trpc";

const SettingsPage: NextPageWithLayout = () => {
  const t = useT();
  const { timeline, setTimeline, hasSettings } = useRiderSettingsTimeline();
  const athleteId = useAthleteId();
  const deleteAllData = trpc.account.deleteAllData.useMutation();
  const [deleting, setDeleting] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  const handleDeleteAllData = React.useCallback(async () => {
    if (!athleteId) return;
    setDeleting(true);
    try {
      await deleteAllData.mutateAsync({ athleteId });
      await signOut({ callbackUrl: "/login" });
    } catch {
      setDeleting(false);
    }
  }, [athleteId, deleteAllData]);

  return (
    <>
      <Toolbar label={t("settings.title")}>
        <SettingsIcon className="size-4" />
        <span className="font-semibold">{t("settings.title")}</span>
      </Toolbar>

      {/* Mobile (< md): full-bleed sections separated by hairline dividers,
          flush under the toolbar — matches the Statistics page. Desktop (md+):
          the centered column of boxed cards. */}
      <div className="flex flex-1 flex-col overflow-y-auto pb-4 md:items-center md:p-6">
        <div className="divide-border border-border flex w-full flex-col divide-y border-b md:max-w-5xl md:gap-6 md:divide-y-0 md:border-0">
          <RiderMetricCards
            timeline={timeline}
            onTimelineChange={setTimeline}
            hasSettings={hasSettings}
          />

          <section className="md:border-border md:bg-card p-5 md:rounded-sm md:border">
            <EquipmentFields timeline={timeline} setTimeline={setTimeline} />
          </section>

          <section className="md:border-border md:bg-card p-5 md:rounded-sm md:border">
            <CardTitle
              tooltip={t("settings.loadAlgorithm.tooltip")}
              description={t("settings.loadAlgorithm.description")}
              className="mb-5"
            >
              {t("settings.loadAlgorithm.title")}
            </CardTitle>
            <LoadAlgorithmFields
              timeline={timeline}
              setTimeline={setTimeline}
            />
          </section>

          <section className="md:border-border md:bg-card p-5 md:rounded-sm md:border">
            <CardTitle description={t("settings.preferences.description")}>
              {t("settings.preferences.title")}
            </CardTitle>
            <div className="flex flex-col gap-5">
              <LanguageSelect />
              <ResetHintsButton />
            </div>
          </section>

          <DangerZone
            onDeleteAllData={handleDeleteAllData}
            deleting={deleting}
            deleteDialogOpen={deleteDialogOpen}
            setDeleteDialogOpen={setDeleteDialogOpen}
          />
        </div>
      </div>
    </>
  );
};

export default SettingsPage;
