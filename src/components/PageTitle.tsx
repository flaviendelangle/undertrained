import Head from "next/head";
import { useRouter } from "next/router";

import { formatPageTitle, resolveRouteTitle } from "~/utils/pageTitles";

interface PageTitleProps {
  /**
   * Overrides the route-based default, e.g. an activity or period name. When
   * omitted, the title is derived from the current route.
   */
  title?: string;
}

/**
 * Sets the browser tab title for the current page. A `<title>` rendered by a
 * page component overrides the default emitted by the layout (Next.js dedupes
 * `<title>` tags, keeping the last one).
 */
export const PageTitle = ({ title }: PageTitleProps) => {
  const router = useRouter();
  const label = title ?? resolveRouteTitle(router.pathname);

  return (
    <Head>
      <title>{formatPageTitle(label)}</title>
    </Head>
  );
};
