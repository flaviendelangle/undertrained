import type { GetServerSideProps } from "next";

import { legacyActivityRedirect } from "~/utils/legacyActivityRedirect";

export const getServerSideProps: GetServerSideProps = async ({ query }) => ({
  redirect: {
    destination: legacyActivityRedirect("/activities/map", query),
    permanent: false,
  },
});
export default function LegacyHeatmap() {
  return null;
}
