import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async ({ params }) => ({
  redirect: {
    destination: `/routes/${encodeURIComponent(String(params?.routeId))}`,
    permanent: false,
  },
});
export default function LegacyRoute() {
  return null;
}
