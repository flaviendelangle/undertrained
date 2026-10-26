import { BikeIcon } from "lucide-react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";

import { PageToolbar } from "~/components/layouts/PageToolbar";
import { WorkoutBuilder } from "~/components/workouts/WorkoutBuilder";
import { useStructuredWorkout } from "~/hooks/structuredWorkouts";
import { useRememberRecentItem } from "~/hooks/useRememberRecentItem";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";

export const getServerSideProps: GetServerSideProps = async () => {
  return { props: {} };
};

const EditWorkoutPage: NextPageWithLayout = () => {
  const t = useT();
  const router = useRouter();

  const raw = router.query.workoutId;
  const workoutId = Number(Array.isArray(raw) ? raw[0] : raw);

  const { data: workout, isError } = useStructuredWorkout(
    Number.isFinite(workoutId) ? workoutId : null,
  );
  useRememberRecentItem(
    workout && !isError ? { kind: "workout", id: workout.id } : null,
  );

  // The builder seeds its undo history from `workout`, so it must not mount
  // before the data is there — and must remount if the id changes.
  if (workout && !isError)
    return <WorkoutBuilder key={workout.id} workout={workout} />;

  return (
    <>
      <PageToolbar
        title={t("workouts.editWorkout")}
        icon={BikeIcon}
        backHref="/workouts"
      />
      {isError && (
        <p className="text-muted-foreground p-8 text-center text-sm">
          {t("workouts.notFound")}
        </p>
      )}
    </>
  );
};

export default EditWorkoutPage;
