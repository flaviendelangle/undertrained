import Head from "next/head";
import { useRouter } from "next/router";

import { useT } from "~/i18n/useT";
import { formatPageTitle, resolveRouteTitleKey } from "~/utils/pageTitles";

interface PageTitleProps {
  /**
   * Overrides the route-based default, e.g. an activity or period name. When
   * omitted, the title is derived from the current route and localized.
   */
  title?: string;
}

/**
 * Sets the browser tab title for the current page. The route-based default is
 * translated through the active locale, so the tab follows the language
 * selected in Settings. A `<title>` rendered by a page component overrides the
 * default emitted by the layout (Next.js dedupes `<title>` tags, keeping the
 * last one).
 */
export const PageTitle = ({ title }: PageTitleProps) => {
  const router = useRouter();
  const t = useT();

  const routeKey = resolveRouteTitleKey(router.pathname);
  const label = title ?? (routeKey ? t(routeKey) : undefined);

  return (
    <Head>
      <title>{formatPageTitle(label)}</title>
    </Head>
  );
};
