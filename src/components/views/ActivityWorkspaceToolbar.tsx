import type { ReactNode } from "react";

import { BarChart3Icon, ListIcon, MapIcon } from "lucide-react";

import { PageToolbar } from "~/components/layouts/PageToolbar";
import { useActivityView } from "~/hooks/useActivityView";
import { useT } from "~/i18n/useT";

export function ActivityWorkspaceToolbar({
  presentation,
  actions,
}: {
  presentation: "list" | "map" | "charts";
  actions?: ReactNode;
}) {
  const t = useT();
  const scope = useActivityView();
  return (
    <PageToolbar
      title={t("activities.pageTitle")}
      icon={ListIcon}
      actions={actions}
      tabs={{
        label: t("views.presentation"),
        items: (
          [
            {
              id: "list",
              path: "/activities",
              label: "views.list",
              icon: ListIcon,
            },
            {
              id: "map",
              path: "/activities/map",
              label: "views.map",
              icon: MapIcon,
            },
            {
              id: "charts",
              path: "/activities/charts",
              label: "views.charts",
              icon: BarChart3Icon,
            },
          ] as const
        ).map(({ id, path, label, icon }) => ({
          label: t(label),
          icon,
          href: scope.href(path),
          active: presentation === id,
        })),
      }}
    />
  );
}
