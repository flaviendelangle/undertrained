import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: "/views", permanent: false },
});
export default function LegacyPeriods() {
  return null;
}
