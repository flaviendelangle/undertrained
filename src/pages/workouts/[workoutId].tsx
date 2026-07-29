import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";

import { WorkoutBuilder } from "~/components/workouts/WorkoutBuilder";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import { isStructuredWorkoutsEnabled } from "~/lib/features";
import type { NextPageWithLayout } from "~/pages/_app";
import { trpc } from "~/utils/trpc";

export const getServerSideProps: GetServerSideProps = async () => {
  if (!isStructuredWorkoutsEnabled) return { notFound: true };
  return { props: {} };
};

const EditWorkoutPage: NextPageWithLayout = () => {
  const t = useT();
  const router = useRouter();
  const athleteId = useAthleteId();

  const raw = router.query.workoutId;
  const workoutId = Number(Array.isArray(raw) ? raw[0] : raw);
  const enabled = !!athleteId && Number.isFinite(workoutId);

  const { data: workout, isError } = trpc.structuredWorkouts.get.useQuery(
    { athleteId: athleteId!, id: workoutId },
    { enabled },
  );

  if (isError) {
    return (
      <p className="text-muted-foreground p-8 text-center text-sm">
        {t("workouts.notFound")}
      </p>
    );
  }

  // The builder seeds its undo history from `workout`, so it must not mount
  // before the data is there — and must remount if the id changes.
  if (!workout) return null;

  return <WorkoutBuilder key={workout.id} workout={workout} />;
};

export default EditWorkoutPage;
