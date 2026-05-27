import type { GetServerSideProps } from "next";
import { RouteIcon } from "lucide-react";

import { RouteBuilder } from "~/components/routes/RouteBuilder";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { isRoutesEnabled } from "~/lib/features";
import type { NextPageWithLayout } from "~/pages/_app";

export const getServerSideProps: GetServerSideProps = async () => {
  if (!isRoutesEnabled) return { notFound: true };
  return { props: {} };
};

const NewRoutePage: NextPageWithLayout = () => {
  return (
    <>
      <Toolbar>
        <RouteIcon className="size-4" />
        <span className="font-semibold">New route</span>
      </Toolbar>
      <div className="relative flex-1 overflow-hidden">
        <RouteBuilder />
      </div>
    </>
  );
};

export default NewRoutePage;
