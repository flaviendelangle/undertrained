import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: "/routes", permanent: false },
});
export default function LegacyRoutes() {
  return null;
}
