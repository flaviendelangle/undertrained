import { ActivitiesTable } from "~/components/ActivitiesTable";
import { ActivityWorkspaceToolbar } from "~/components/views/ActivityWorkspaceToolbar";
import {
  ActivityViewBoundary,
  SharedViewBar,
} from "~/components/views/SharedViewBar";
import { NextPageWithLayout } from "~/pages/_app";

const ActivitiesPage: NextPageWithLayout = () => {
  return (
    <>
      <ActivityWorkspaceToolbar presentation="list" />
      <SharedViewBar table />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ActivityViewBoundary>
          <ActivitiesTable />
        </ActivityViewBoundary>
      </div>
    </>
  );
};

export default ActivitiesPage;
