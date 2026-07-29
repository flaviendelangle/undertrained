import type { GetServerSideProps } from "next";

import { WorkoutBuilder } from "~/components/workouts/WorkoutBuilder";
import { isStructuredWorkoutsEnabled } from "~/lib/features";
import type { NextPageWithLayout } from "~/pages/_app";

export const getServerSideProps: GetServerSideProps = async () => {
  if (!isStructuredWorkoutsEnabled) return { notFound: true };
  return { props: {} };
};

const NewWorkoutPage: NextPageWithLayout = () => <WorkoutBuilder />;

export default NewWorkoutPage;
