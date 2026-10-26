import type { ReactNode } from "react";

import { RouteIcon } from "lucide-react";

import { PageToolbar } from "~/components/layouts/PageToolbar";

export function RouteToolbar({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <PageToolbar
      title={title}
      icon={RouteIcon}
      backHref="/routes"
      actions={actions}
    />
  );
}
