import { BarChart3Icon, ListIcon, MapIcon } from "lucide-react";

import { PageToolbar } from "~/components/layouts/PageToolbar";
import { useActivityView } from "~/hooks/useActivityView";
import { useRememberRecentItem } from "~/hooks/useRememberRecentItem";
import { useT } from "~/i18n/useT";
import { ACTIVITY_PRESENTATION_PATHS } from "~/utils/activityViewState";

const PRESENTATIONS = [
  { id: "list", label: "views.list", icon: ListIcon },
  { id: "map", label: "views.map", icon: MapIcon },
  { id: "charts", label: "views.charts", icon: BarChart3Icon },
] as const;

export function ActivityWorkspaceToolbar({
  presentation,
}: {
  presentation: keyof typeof ACTIVITY_PRESENTATION_PATHS;
}) {
  const t = useT();
  const scope = useActivityView();
  useRememberRecentItem(
    scope.view ? { kind: "view", id: scope.view.id } : null,
  );
  return (
    <PageToolbar
      title={t("activities.pageTitle")}
      icon={ListIcon}
      tabs={{
        label: t("views.presentation"),
        items: PRESENTATIONS.map(({ id, label, icon }) => ({
          label: t(label),
          icon,
          href: scope.href(ACTIVITY_PRESENTATION_PATHS[id]),
          active: presentation === id,
        })),
      }}
    />
  );
}
