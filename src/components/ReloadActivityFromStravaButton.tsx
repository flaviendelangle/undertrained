import * as React from "react";

import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import { trpc } from "~/utils/trpc";

import { LoadingButton } from "./primitives/LoadingButton";

export function ReloadActivityFromStravaButton(
  props: ReloadActivityFromStravaButtonProps,
) {
  const { stravaId } = props;
  const t = useT();
  const athleteId = useAthleteId();
  const reloadActivity = trpc.activityStreams.reload.useMutation();
  const utils = trpc.useUtils();
  const [loading, setLoading] = React.useState(false);

  return (
    <LoadingButton
      loading={loading}
      onClick={async () => {
        if (!athleteId) return;
        setLoading(true);
        try {
          await reloadActivity.mutateAsync({ stravaId, athleteId });
          await Promise.all([
            utils.activities.get.invalidate({ stravaId }),
            utils.activityStreams.getStreams.invalidate({ stravaId }),
            utils.activities.list.invalidate(),
          ]);
        } finally {
          setLoading(false);
        }
      }}
    >
      {t("activities.reloadFromStrava")}
    </LoadingButton>
  );
}

interface ReloadActivityFromStravaButtonProps {
  stravaId: number;
}
