import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";

import { ActivitiesTable } from "~/components/ActivitiesTable";
import { ActivityWorkspaceToolbar } from "~/components/views/ActivityWorkspaceToolbar";
import {
  ActivityViewBoundary,
  SharedViewBar,
} from "~/components/views/SharedViewBar";
import { useT } from "~/i18n/useT";
import { NextPageWithLayout } from "~/pages/_app";
import { readTimelineReturnTo } from "~/utils/activityLinks";

const ActivitiesPage: NextPageWithLayout = () => {
  const router = useRouter();
  const t = useT();
  const returnTo = readTimelineReturnTo(router.query);
  return (
    <>
      <ActivityWorkspaceToolbar presentation="list" />
      <SharedViewBar table />
      {returnTo && (
        <Link
          href={returnTo}
          className="border-border text-muted-foreground hover:text-foreground flex items-center gap-2 border-b px-4 py-3 text-sm"
        >
          <ArrowLeftIcon className="size-4" />
          {t("charts.activitiesTimeline.back")}
        </Link>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ActivityViewBoundary>
          <ActivitiesTable />
        </ActivityViewBoundary>
      </div>
    </>
  );
};

export default ActivitiesPage;
