import type { GetServerSideProps } from "next";

import { MapToolbar } from "~/components/Map/MapToolbar";
import { RouteBuilder } from "~/components/routes/RouteBuilder";
import { isRoutesEnabled } from "~/lib/features";
import type { NextPageWithLayout } from "~/pages/_app";

export const getServerSideProps: GetServerSideProps = async () => {
  if (!isRoutesEnabled) return { notFound: true };
  return { props: {} };
};

const NewRoutePage: NextPageWithLayout = () => {
  return (
    <>
      <MapToolbar section="new" />
      <div className="relative flex-1 overflow-hidden">
        <RouteBuilder />
      </div>
    </>
  );
};

export default NewRoutePage;
