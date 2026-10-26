import type { GetServerSideProps } from "next";

import { legacyActivityRedirect } from "~/utils/legacyActivityRedirect";

export const getServerSideProps: GetServerSideProps = async ({ query }) => ({
  redirect: {
    destination: legacyActivityRedirect("/activities/charts", query),
    permanent: false,
  },
});
export default function LegacyStatistics() {
  return null;
}
