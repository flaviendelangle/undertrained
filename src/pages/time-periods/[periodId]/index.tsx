import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async ({ params }) => ({
  redirect: {
    destination: `/activities?view=${encodeURIComponent(String(params?.periodId))}`,
    permanent: false,
  },
});
export default function LegacyPeriod() {
  return null;
}
