import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: "/routes/new", permanent: false },
});
export default function LegacyNewRoute() {
  return null;
}
