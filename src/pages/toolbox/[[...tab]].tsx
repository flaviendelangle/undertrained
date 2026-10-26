import * as React from "react";

import { LogInIcon, WrenchIcon } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/router";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

import { LoggedInLayout } from "~/components/layouts/LoggedInLayout";
import { PageToolbar } from "~/components/layouts/PageToolbar";
import { SharedLayout } from "~/components/layouts/SharedLayout";
import { GearCalculator } from "~/components/toolbox/GearCalculator";
import { PaceCalculator } from "~/components/toolbox/PaceCalculator";
import { RacePredictor } from "~/components/toolbox/RacePredictor";
import { ZoneCalculator } from "~/components/toolbox/ZoneCalculator";
import {
  TOOLS,
  type ToolId,
  createToolLabels,
} from "~/components/toolbox/tools";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";

const ToolboxPage: NextPageWithLayout = () => {
  const t = useT();
  const toolLabels = React.useMemo(() => createToolLabels(t), [t]);
  const router = useRouter();
  const rawTab = Array.isArray(router.query.tab)
    ? router.query.tab[0]
    : undefined;
  const activeTool = TOOLS.some((t) => t.id === rawTab)
    ? (rawTab as ToolId)
    : undefined;
  const { status } = useSession();

  React.useEffect(() => {
    if (router.isReady && !activeTool) {
      void router.replace(`/toolbox/${TOOLS[0].id}`);
    }
  }, [router, activeTool]);

  if (!activeTool) return null;

  return (
    <>
      <PageToolbar
        title={t("nav.toolbox")}
        icon={WrenchIcon}
        actions={
          status !== "authenticated" ? (
            <ToolbarPrimitive.Link
              render={<Link href="/login" />}
              aria-label={t("toolbox.signIn")}
              title={t("toolbox.signIn")}
              className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm font-medium transition-colors"
            >
              <LogInIcon className="size-4" />
              <span className="hidden sm:inline">{t("toolbox.signIn")}</span>
            </ToolbarPrimitive.Link>
          ) : undefined
        }
        tabs={{
          label: t("nav.toolbox"),
          items: TOOLS.map((tool) => ({
            label: toolLabels[tool.id],
            icon: tool.icon,
            href: `/toolbox/${tool.id}`,
            active: activeTool === tool.id,
          })),
        }}
      />
      {/* Mobile (< md): the tool goes full-bleed, flush under the toolbar.
          Desktop (md+): padded, matching the Statistics page. */}
      <div className="flex flex-1 flex-col overflow-auto pb-4 md:p-4">
        {activeTool === "pace-calculator" && <PaceCalculator />}
        {activeTool === "race-predictor" && <RacePredictor />}
        {activeTool === "zone-calculator" && <ZoneCalculator />}
        {activeTool === "gear-calculator" && <GearCalculator />}
      </div>
    </>
  );
};

ToolboxPage.getLayout = function getLayout(page) {
  return <ToolboxLayout>{page}</ToolboxLayout>;
};

function ToolboxLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  if (status === "authenticated") {
    return <LoggedInLayout>{children}</LoggedInLayout>;
  }

  return <SharedLayout>{children}</SharedLayout>;
}

export default ToolboxPage;
