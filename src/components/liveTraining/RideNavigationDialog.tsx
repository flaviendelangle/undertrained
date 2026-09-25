import { useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { useRideNavigationGuard } from "~/hooks/useRideNavigationGuard";
import { useT } from "~/i18n/useT";

export function RideNavigationDialog({
  enabled,
  onSave,
}: {
  enabled: boolean;
  onSave: () => void;
}) {
  const t = useT();
  const navigation = useRideNavigationGuard(enabled);
  const [saveError, setSaveError] = useState(false);
  const cancel = () => {
    navigation.cancel();
    setSaveError(false);
  };
  const save = () => {
    try {
      onSave();
      setSaveError(false);
      navigation.proceed();
    } catch {
      setSaveError(true);
    }
  };
  return (
    <AlertDialog
      open={navigation.open}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>{t("liveTraining.leaveTitle")}</AlertDialogTitle>
        <AlertDialogDescription>
          {t("liveTraining.leaveDescription")}
        </AlertDialogDescription>
        {saveError && (
          <p role="alert" className="text-destructive">
            {t("common.saveError")}
          </p>
        )}
        <AlertDialogFooter>
          <Button variant="outline" onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={navigation.proceed}>
            {t("liveTraining.discardAndLeave")}
          </Button>
          <Button onClick={save}>{t("liveTraining.saveAndLeave")}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
