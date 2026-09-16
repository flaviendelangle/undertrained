import type { GetServerSideProps } from "next";

import { WorkoutBuilder } from "~/components/workouts/WorkoutBuilder";
import type { NextPageWithLayout } from "~/pages/_app";

export const getServerSideProps: GetServerSideProps = async () => {
  return { props: {} };
};

const NewWorkoutPage: NextPageWithLayout = () => <WorkoutBuilder />;

export default NewWorkoutPage;
