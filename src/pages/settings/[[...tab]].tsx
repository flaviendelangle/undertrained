import * as React from "react";

import { SettingsIcon } from "lucide-react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/router";

import { CardTitle } from "~/components/primitives/CardTitle";
import { ResetHintsButton } from "~/components/settings/ResetHintsButton";
import { ChangePointsTimeline } from "~/components/settings/ChangePointsTimeline";
import {
  DangerZone,
  EquipmentFields,
  LoadAlgorithmFields,
} from "~/components/settings/layouts/shared";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import type { NextPageWithLayout } from "~/pages/_app";
import { trpc } from "~/utils/trpc";

const SettingsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { timeline, setTimeline, hasSettings } = useRiderSettingsTimeline();
  const athleteId = useAthleteId();
  const deleteAllData = trpc.account.deleteAllData.useMutation();
  const [deleting, setDeleting] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  // Redirect old /settings/periods to /periods
  React.useEffect(() => {
    if (!router.isReady) return;
    const rawTab = Array.isArray(router.query.tab)
      ? router.query.tab[0]
      : undefined;
    if (rawTab === "periods") {
      void router.replace("/periods");
    }
  }, [router]);

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
      <Toolbar>
        <SettingsIcon className="size-4" />
        <span className="font-semibold">Settings</span>
      </Toolbar>

      <div className="flex flex-1 flex-col items-center overflow-y-auto p-4 sm:p-6 max-sm:px-0">
        <div className="flex w-full max-w-5xl flex-col gap-4 sm:gap-6">
          <section className="border-border bg-card rounded-sm border max-sm:border-0 p-5">
            <ChangePointsTimeline
              timeline={timeline}
              onTimelineChange={setTimeline}
              hasSettings={hasSettings}
            />
          </section>

          <section className="border-border bg-card rounded-sm border max-sm:border-0 p-5">
            <EquipmentFields
              timeline={timeline}
              setTimeline={setTimeline}
            />
          </section>

          <section className="border-border bg-card rounded-sm border max-sm:border-0 p-5">
            <CardTitle
              tooltip="TSS uses power data (most accurate for cycling with a power meter). HRSS uses heart rate (works for any sport with an HR monitor). rTSS/sTSS use pace (good for running/swimming without power)."
              description="Choose which training load metric to display for each sport category."
              className="mb-5"
            >
              Load Algorithm
            </CardTitle>
            <LoadAlgorithmFields
              timeline={timeline}
              setTimeline={setTimeline}
            />
          </section>

          <section className="border-border bg-card rounded-sm border max-sm:border-0 p-5">
            <CardTitle
              description="Manage app preferences and onboarding hints."
            >
              Preferences
            </CardTitle>
            <ResetHintsButton />
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
