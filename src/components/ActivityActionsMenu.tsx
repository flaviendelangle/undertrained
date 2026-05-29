import * as React from "react";

import { EllipsisIcon, ExternalLink, RefreshCw } from "lucide-react";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import { trpc } from "~/utils/trpc";

export function ActivityActionsMenu(props: ActivityActionsMenuProps) {
  const { stravaId } = props;
  const t = useT();
  const athleteId = useAthleteId();
  const reloadActivity = trpc.activityStreams.reload.useMutation();
  const utils = trpc.useUtils();
  const [loading, setLoading] = React.useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ToolbarPrimitive.Button
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                disabled={loading}
              >
                {loading ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <EllipsisIcon className="size-4" />
                )}
              </Button>
            }
          />
        }
      />
      <DropdownMenuContent align="end" className="w-auto whitespace-nowrap">
        <DropdownMenuLinkItem
          href={`https://www.strava.com/activities/${stravaId}`}
          target="_blank"
        >
          <ExternalLink />
          {t("activities.viewOnStrava")}
        </DropdownMenuLinkItem>
        <DropdownMenuItem
          disabled={loading}
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
          <RefreshCw />
          {t("activities.reloadFromStrava")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ActivityActionsMenuProps {
  stravaId: number;
}
