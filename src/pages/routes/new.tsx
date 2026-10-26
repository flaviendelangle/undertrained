import type { GetServerSideProps } from "next";

import { RouteBuilder } from "~/components/routes/RouteBuilder";
import { RouteToolbar } from "~/components/routes/RouteToolbar";
import { useT } from "~/i18n/useT";
import { isRoutesEnabled } from "~/lib/features";
import type { NextPageWithLayout } from "~/pages/_app";

export const getServerSideProps: GetServerSideProps = async () => {
  if (!isRoutesEnabled) return { notFound: true };
  return { props: {} };
};

const NewRoutePage: NextPageWithLayout = () => {
  const t = useT();
  return (
    <>
      <RouteToolbar title={t("routes.newRoute")} />
      <div className="relative flex-1 overflow-hidden">
        <RouteBuilder />
      </div>
    </>
  );
};

export default NewRoutePage;
